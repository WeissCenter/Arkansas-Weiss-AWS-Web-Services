import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
import type {
  ValidationTemplate,
  ValidationError,
  Schema,
  StringSchema,
  NumberSchema,
  SelectSchema,
  HeaderSelect,
  HeaderValidator,
  HeaderHTMLValidator,
  RowCountValidator,
  TypeFieldCheckValidator,
  TypeFieldCheckHTMLValidator,
} from "./types";
import { createDefaultValidationError, DEFAULT_ERROR_TYPE, validateReportingYear, VALIDATION_TEMPLATE_ERRORS } from "./types/core";

export type { ValidationError } from "./types";

// ============================================================================
// Schema Validators (Pure Functions)
// ============================================================================

function validateStringSchema(
  schema: StringSchema,
  value: string,
  ruleName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check if value is in allowed array
  if (schema.array && schema.value?.length) {
    const values = schema.value as string[];
    if (!values.some((v) => v === value)) {
      errors.push({
        error: schema.errorType || DEFAULT_ERROR_TYPE,
        context: 'validateStringSchema: value not in allowed array',
        rule: ruleName,
        schema: schema.name,
      });
    }
  }

  // Check exact string match
  if (!schema.array && schema.value?.length && schema.value !== value) {
    errors.push({
      error: schema.errorType || DEFAULT_ERROR_TYPE,
      context: 'validateStringSchema: exact match failed',
      rule: ruleName,
      schema: schema.name,
    });
  }

  // Check regex pattern
  if (schema.regex) {
    const regexp = new RegExp(schema.regex);
    if (!regexp.test(value)) {
      errors.push({
        error: schema.errorType || DEFAULT_ERROR_TYPE,
        context: 'validateStringSchema: regex pattern failed',
        rule: ruleName,
        schema: schema.name,
      });
    }
  }

  // Check max length
  if (schema.maxLength !== undefined) {
    if ((schema.maxLength === 0 && value) || value.length > schema.maxLength) {
      errors.push({
        error: schema.errorType || DEFAULT_ERROR_TYPE,
        context: 'validateStringSchema: max length exceeded',
        rule: ruleName,
        schema: schema.name,
      });
    }
  }

  return errors;
}

function validateNumberSchema(
  schema: NumberSchema,
  value: any,
  ruleName: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof value !== "number") {
    return [
      {
        error: schema.errorType || DEFAULT_ERROR_TYPE,
        context: 'validateNumberSchema: value is not a number',
        rule: ruleName,
        schema: schema.name,
      },
    ];
  }

  if (schema.min !== undefined && value < schema.min) {
    errors.push({
      error: schema.errorType || DEFAULT_ERROR_TYPE,
      context: 'validateNumberSchema: value below minimum',
      rule: ruleName,
      schema: schema.name,
    });
  }

  if (schema.max !== undefined && value > schema.max) {
    errors.push({
      error: schema.errorType || DEFAULT_ERROR_TYPE,
      context: 'validateNumberSchema: value above maximum',
      rule: ruleName,
      schema: schema.name,
    });
  }

  return errors;
}

function validateSelectSchema(
  schema: SelectSchema,
  value: string | HeaderSelect,
  ruleName: string,
  context?: Record<string, any>
): ValidationError[] {
  if (!schema.value) {
    return [];
  }

  // Handle when value is an array of allowed strings
  if (Array.isArray(schema.value)) {
    const stringValue = value as string;
    if (!schema.value.some((v: string) => v === stringValue)) {
      return [
        {
          error: schema.errorType || DEFAULT_ERROR_TYPE,
          context: 'validateSelectSchema: value not in allowed array',
          rule: ruleName,
          schema: schema.name,
        },
      ];
    }
    return [];
  }

  // Handle when value is a HeaderSelect object (for typeFieldCheck)
  if (typeof schema.value === "object" && !Array.isArray(schema.value)) {
    const expectedValue = context?.[schema.field];
    if (!expectedValue) {
      return [
        {
          error: schema.errorType || DEFAULT_ERROR_TYPE,
          context: `validateSelectSchema: Missing context value for field ${schema.field}`,
          rule: ruleName,
          schema: schema.name,
        },
      ];
    }

    const stringValue = value as string;
    if (stringValue !== expectedValue) {
      return [
        {
          error: schema.errorType || DEFAULT_ERROR_TYPE,
          context: `validateSelectSchema: Value mismatch for field ${schema.field}, expected "${expectedValue}", got "${stringValue}"`,
          rule: ruleName,
          schema: schema.name,
        },
      ];
    }
    return [];
  }

  // Handle single string value
  if (typeof schema.value === "string") {
    const stringValue = value as string;
    if (!stringValue.includes(schema.value)) {
      return [
        {
          error: schema.errorType || DEFAULT_ERROR_TYPE,
          context: `validateSelectSchema: Value does not include expected substring "${schema.value}"`,
          rule: ruleName,
          schema: schema.name,
        },
      ];
    }
  }

  return [];
}

function validateSchema(
  schema: Schema,
  value: any,
  ruleName: string,
  context?: Record<string, any>
): ValidationError[] {
  switch (schema.type) {
    case "string":
      return validateStringSchema(
        schema,
        value?.toString().trim() || "",
        ruleName
      );
    case "number":
      return validateNumberSchema(schema, value, ruleName);
    case "select":
      return validateSelectSchema(schema, value, ruleName, context);
  }
}

// ============================================================================
// CSV Validator Handlers (Pure Functions)
// ============================================================================

function handleHeaderValidator(
  validator: HeaderValidator,
  header: any[],
  ruleName: string,
  context?: Record<string, any>
): ValidationError[] {
  return validator.schema.flatMap((schema, index) => {
    const value = header[index];
    return validateSchema(schema, value, ruleName, context);
  });
}

function handleRowCountValidator(
  validator: RowCountValidator,
  header: any[],
  rowCount: number,
  ruleName: string
): ValidationError[] {
  const expectedCount =
    typeof validator.value === "number"
      ? validator.value
      : (header[validator.value.headerIndex] as number);

  if (rowCount !== expectedCount) {
    return [
      {
        error: validator.errorType || DEFAULT_ERROR_TYPE,
        context: `handleRowCountValidator: Expected ${expectedCount} rows, got ${rowCount}`,
        rule: ruleName,
      },
    ];
  }

  return [];
}

function handleTypeFieldCheckValidator(
  validator: TypeFieldCheckValidator,
  header: any[],
  ruleName: string,
  context?: Record<string, any>
): ValidationError[] {
  return validator.schema.flatMap((schema) => {
    if (schema.type !== "select") {
      return [];
    }

    const selectSchema = schema as SelectSchema;

    if (!selectSchema.value) {
      return [
        {
          error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
          context: `handleTypeFieldCheckValidator: Missing select schema value`,
          rule: ruleName,
          schema: selectSchema.name,
        },
      ];
    }

    // Handle when value is a HeaderSelect object
    if (
      typeof selectSchema.value === "object" &&
      !Array.isArray(selectSchema.value)
    ) {
      const headerSelect = selectSchema.value as HeaderSelect;
      if (!selectSchema.field) {
        return [
          {
            error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
            context: `handleTypeFieldCheckValidator: Missing field`,
            rule: ruleName,
            schema: selectSchema.name,  
          },
        ];
      }

      let selectValue: string = String(header[headerSelect.headerIndex] ?? '').trim();

      if (!selectValue) {
        return [
          {
            error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
            context: `handleTypeFieldCheckValidator: Missing value for field ${selectSchema.field}`,
            rule: ruleName,
            schema: selectSchema.name,
          },
        ];
      }

      // Apply substring if configured
      if (headerSelect.substring) {
        if (headerSelect.substring.start === headerSelect.substring.end) {
          return [
            {
              error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
              context: `handleTypeFieldCheckValidator: Invalid substring range`,
              rule: ruleName,
              schema: selectSchema.name,
            },
          ];
        }

        if (headerSelect.substring.end && headerSelect.substring.start > headerSelect.substring.end) {
          return [
            {
              error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
              context: `handleTypeFieldCheckValidator: Substring start greater than end`,
              rule: ruleName,
              schema: selectSchema.name,
            },
          ];
        }

        selectValue = selectValue.substring(
          headerSelect.substring.start,
          headerSelect.substring.end
        );
      }

      // Validate against context
      const expectedValue = context?.[selectSchema.field];
      
      if (selectSchema.field === "reportingYear" && expectedValue) {
        // FIXME: This exists to handle the case where reportingYear in the context is "2023" but the header contains "2022-2023" or "2022 2023"
        console.warn("handling reportingYear special case");
        if (!validateReportingYear(selectValue, expectedValue)) {
          return [
            {
              error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
              context: `handleTypeFieldCheckValidator: Value mismatch for field ${selectSchema.field}, expected reporting year matching "${expectedValue}", got "${selectValue}"  check validateReportingYear function`,
              rule: ruleName,
              schema: selectSchema.name,
            },
          ];
        } else {
          return [];
        }
      }

      if (!expectedValue) {
        return [
          {
            error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
            context: `handleTypeFieldCheckValidator: Missing context value for field ${selectSchema.field}`,
            rule: ruleName,
            schema: selectSchema.name,
          },
        ];
      }

      if (selectValue !== expectedValue) {
        return [
          {
            error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
            context: `handleTypeFieldCheckValidator: Value mismatch for field ${selectSchema.field}, expected "${expectedValue}", got "${selectValue}"`,
            rule: ruleName,
            schema: selectSchema.name,
          },
        ];
      }

      return [];
    }
    // Handle when value is an array of strings
    else if (Array.isArray(selectSchema.value)) {
      return validateSelectSchema(
        selectSchema,
        header[0]?.trim(),
        ruleName,
        context
      );
    }

    return [];
  });
}

// ============================================================================
// HTML Helper Functions
// ============================================================================

function getHTMLElementValue(
  schema: Schema,
  $: cheerio.CheerioAPI
): string | undefined {
  const element = schema.element;

  if (!element) {
    return;
  }

  let selector = element.tag;

  if (element.class?.length) {
    selector += `.${element.class}`;
  }

  if (element.id?.length) {
    selector += `#${element.id}`;
  }

  let baseElement = $(selector);

  if (element.index !== undefined) {
    baseElement = baseElement.eq(element.index);
  }

  return baseElement.text()?.trim();
}

// ============================================================================
// HTML Validator Handlers (Pure Functions)
// ============================================================================

function handleHeaderHTMLValidator(
  validator: HeaderHTMLValidator,
  $: cheerio.CheerioAPI,
  ruleName: string,
  context?: Record<string, any>
): ValidationError[] {
  return validator.schema.flatMap((schema) => {
    const value = getHTMLElementValue(schema, $);

    if (!value) {
      return [
        {
          error: schema.errorType || DEFAULT_ERROR_TYPE,
          context: `handleHeaderHTMLValidator: Missing value for field`,
          rule: ruleName,
          schema: schema.name,
        },
      ];
    }

    return validateSchema(schema, value, ruleName, context);
  });
}

function handleTypeFieldCheckHTMLValidator(
  validator: TypeFieldCheckHTMLValidator,
  $: cheerio.CheerioAPI,
  ruleName: string,
  context?: Record<string, any>
): ValidationError[] {
  return validator.schema.flatMap((schema) => {
    if (schema.type === "select") {
      const selectSchema = schema as SelectSchema;

      if (!selectSchema.value) {
        return [];
      }

      const value = getHTMLElementValue(schema, $);

      if (!value) {
        return [
          {
            error: selectSchema.errorType || validator.errorType || DEFAULT_ERROR_TYPE,
            context: "handleTypeFieldCheckHTMLValidator: Missing value for schema.type select",
            rule: ruleName,
            schema: schema.name,
          },
        ];
      }

      // Handle array of allowed values
      if (Array.isArray(selectSchema.value)) {
        return validateSelectSchema(selectSchema, value, ruleName, context);
      }
      // Handle context field comparison
      else if (typeof selectSchema.value === "string") {
        const expectedValue = context?.[selectSchema.value];

        if (selectSchema.field === "reportingYear" && expectedValue) {
          // FIXME: This exists to handle the case where reportingYear in the context is "2023" but the HTML contains "Year: 2022-23"
          console.warn("handling reportingYear special case");
          if (!validateReportingYear(value, expectedValue)) {
            return [
              {
                error: selectSchema.errorType || DEFAULT_ERROR_TYPE,
                context: `handleTypeFieldCheckHTMLValidator: Value mismatch for field ${selectSchema.field}, expected reporting year matching "${expectedValue}", got "${value}" check validateReportingYear function`,
                rule: ruleName,
                schema: selectSchema.name,
              },
            ];
          } else {
            return [];
          }
        }


        if (!value.includes(expectedValue || "")) {
          return [
            {
              error: selectSchema.errorType || validator.errorType || DEFAULT_ERROR_TYPE,
              context: `handleTypeFieldCheckHTMLValidator: Value mismatch for field ${selectSchema.value}, expected "${expectedValue}", got "${value}"`,
              rule: ruleName,
              schema: schema.name,
            },
          ];
        }
      }

      return [];
    } else if (schema.type === "string") {
      const value = getHTMLElementValue(schema, $);

      if (!value) {
        return [
          {
            error: schema.errorType || validator.errorType || DEFAULT_ERROR_TYPE,
            context: "handleTypeFieldCheckHTMLValidator: Missing value for schema.type string",
            rule: ruleName,
            schema: schema.name,
          },
        ];
      }

      return validateSchema(schema, value, ruleName, context);
    }

    return [];
  });
}

// ============================================================================
// Main Validation Functions
// ============================================================================

function isWorkbook(data: XLSX.WorkBook) {
  return "Sheets" in data;
}

function deduplicateErrors(errors: ValidationError[]): ValidationError[] {
  const uniqueErrors = new Map<string, ValidationError>();

  for (const error of errors) {
    const key = `${error.schema ?? ''}|${error.rule ?? ''}`;
    if (!uniqueErrors.has(key)) {
      uniqueErrors.set(key, error);
    }
  }

  return Array.from(uniqueErrors.values());
}

export function validate(
  data: XLSX.WorkBook | string,
  template: ValidationTemplate,
  context?: Record<string, any>
): ValidationError[] {
  try {
    let errors: ValidationError[];
  
    if (typeof data === "string") {
      errors = handleHTML(data, template, context);
    } else if (isWorkbook(data)) {
      errors = handleCSV(data, template, context);
    } else {
      // console.error("unknown data type");
      return [createDefaultValidationError('validate: unknown data type')];
    }
  
    errors = deduplicateErrors(errors);
    errors = errors.map((error) => {
      return {
        ...error,
        message: VALIDATION_TEMPLATE_ERRORS[error.error],
      };
    });
    return errors;
  } catch (err) {
    console.log("Error during validation:", err);
    return [createDefaultValidationError('validate: exception during validation')];
  }
}

function handleHTML(
  data: string,
  template: ValidationTemplate,
  context?: Record<string, any>
): ValidationError[] {
  try {
    const $ = cheerio.load(data);

    return template.rules.flatMap(({ name, validator }) => {
      switch (validator.type) {
        case "headerHTML":
          return handleHeaderHTMLValidator(validator, $, name, context);
        case "typeFieldCheckHTML":
          return handleTypeFieldCheckHTMLValidator(validator, $, name, context);
        default:
          return [];
      }
    });
  } catch (err) {
    return [createDefaultValidationError('handleHTML: failed to parse HTML')];
  }
}


function handleCSV(
  data: XLSX.WorkBook,
  template: ValidationTemplate,
  context?: Record<string, any>
): ValidationError[] {
  try {
    const sheet = data.Sheets[data.SheetNames[0]];
    const sheetJSON = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const header = sheetJSON.shift() as any[];
    const rowCount = sheetJSON.length;

    return template.rules.flatMap(({ name, validator }) => {
      switch (validator.type) {
        case "header":
          return handleHeaderValidator(validator, header, name, context);
        case "rowCount":
          return handleRowCountValidator(validator, header, rowCount, name);
        case "typeFieldCheck":
          return handleTypeFieldCheckValidator(validator, header, name, context);
        default:
          return [];
      }
    });
  } catch (err) {
    console.log("Error during CSV validation:", err);
    return [createDefaultValidationError('handleCSV: failed to parse CSV data')];
  }
}
