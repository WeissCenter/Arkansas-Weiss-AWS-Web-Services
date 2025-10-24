import { ValidationRule } from "./types/ValidationRule";

import { ValidationTemplate } from "./types/ValidationTemplate";
import { ValidatorType } from "./types/ValidatorType";
import { NumberSchema } from "./types/schemas/NumberSchema";
import { StringSchema } from "./types/schemas/StringSchema";
import { HeaderValidator } from "./types/validators/HeaderValidator";
import * as XLSX from "xlsx";
import { HeaderSelect, RowCountValidator } from "./types/validators/RowCountValidator";
import * as cheerio from "cheerio";
import { Schema } from "./types/schemas/Schema";
import { TypeFieldValidator } from "./types/validators/TypeFieldValidator";
import { TypeFieldSchema } from "./types/schemas/TypeFieldSchema";

export type ValidationError = { error: string; header?: string; rule?: string };

function isWorkbook(data: XLSX.WorkBook) {
  return "Sheets" in data;
}

export function validate(data: XLSX.WorkBook | string, template: ValidationTemplate, context?: Record<string, any>) {
  const errors: ValidationError[] = [];

  if (typeof data === "string") {
    // html
    handleHTML(data, template, errors, context);
  } else if (isWorkbook(data)) {
    // csv or excel
    handleCSV(data, template, errors, context);
  } else {
    // word for now
    console.error("unknown data type");
  }

  return errors;
}

function handleHTML(data: string, template: ValidationTemplate, errors: ValidationError[], context?: Record<string, any>) {
  try {
    const $ = cheerio.load(data);

    for (const { name, validator } of template.rules) {
      const type = validator.type;

      switch (type) {
        case ValidatorType.HeaderHTML: {
          const headerValidator = validator as HeaderValidator;

          for (const [index, schema] of headerValidator.schema.entries()) {
            const selectValue = getSelectValue(schema, $);

            if (!selectValue) {
              errors.push({
                error: schema.errorText || "failed to match html file value to required values" + schema.name
              });
              continue;
            }

            headerValidate(schema, selectValue, errors, name, context);
          }
          break;
        }
        case ValidatorType.typeFieldCheckHTML: {
          const typeFieldValidator = validator as TypeFieldValidator;

          for (const [index, schema] of typeFieldValidator.schema.entries()) {
            switch (schema.type) {
              case "select": {
                const select = schema as TypeFieldSchema;

                if (!select?.value) {
                  continue;
                }

                const selectValue = getSelectValue(select, $);

                if (!selectValue) {
                  errors.push({
                    error: schema.errorText || "Failed to match html file value to required values" + schema.name
                  });
                  continue;
                }

                if (Array.isArray(select.value) && !select.value.some((val) => val === selectValue)) {
                  errors.push({
                    error: schema.errorText || "Failed to match html file value to required values" + schema.name
                  });
                } else if (!selectValue.includes(context?.[select.value as string] || "")) {
                  errors.push({
                    error: schema.errorText || "Failed to match html file value to required value" + schema.name
                  });
                }

                break;
              }
              case "number": {
                break;
              }
              case "string": {
                const string = schema as StringSchema;

                const selectValue = getSelectValue(schema, $);

                if (!selectValue) {
                  errors.push({
                    error: schema.errorText || "failed to match html file value to required values"
                  });
                  continue;
                }

                handleStringSchema(string, selectValue?.trim(), errors, schema, name, context);

                break;
              }
            }
          }
          break;
        }
      }
    }
  } catch (err) {
    errors.push({ error: "Failed to parse html" });
  }
}

function getSelectValue(select: Schema, $: cheerio.CheerioAPI) {
  const element = select.element;

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

  if (element.index) {
    baseElement = baseElement.eq(element.index);
  }

  const baseElementText = baseElement.text()?.trim();

  return baseElementText;
}

function headerValidate(schema: Schema, select: string, errors: ValidationError[], name: string, context?: Record<string, any>) {
  switch (schema.type) {
    case "number": {
      const numberSchema = schema as NumberSchema;

      if (typeof select !== "number") {
        errors.push({
          error: schema.errorText || "Invalid data type for number header",
          header: schema.name,
          rule: name
        });
      }

      break;
    }
    case "string": {
      const stringSchema = schema as StringSchema;

      handleStringSchema(stringSchema, select?.trim(), errors, schema, name, context);

      break;
    }
  }
}

function handleStringSchema(stringSchema: StringSchema, select: string, errors: ValidationError[], schema: Schema, name: string, context?: Record<string, any>) {
  if (stringSchema.array && stringSchema.value?.length) {
    const values = stringSchema.value as string[];

    if (!values.some((value) => select === value)) {
      errors.push({
        error: schema.errorText || "Header value not in the allowed list of values",
        header: schema.name,
        rule: name
      });
    }
  }

  if (!stringSchema.array && stringSchema.value?.length) {
    if (stringSchema.value !== select) {
      errors.push({
        error: schema.errorText || "Header string value is invalid",
        header: schema.name,
        rule: name
      });
    }
  }

  if (stringSchema.regex) {
    const regexp = new RegExp(stringSchema.regex);

    if (!regexp.test(select)) {
      errors.push({
        error: schema.errorText || "Header string value does not match the regex",
        header: schema.name,
        rule: name
      });
    }
  }

  if (stringSchema.maxLength && ((stringSchema.maxLength === 0 && !select) || select.length > stringSchema.maxLength)) {
    errors.push({
      error: schema.errorText || "Header string value exceeds the max length",
      header: schema.name,
      rule: name
    });
  }
}

function handleCSV(data: XLSX.WorkBook, template: ValidationTemplate, errors: ValidationError[], context?: Record<string, any>) {
  const sheet = data.Sheets[data.SheetNames[0]];

  const sheetJSON = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const header = sheetJSON.shift() as any[];

  for (const { name, validator } of template.rules) {
    const type = validator.type;

    switch (type) {
      case ValidatorType.Header: {
        const headerValidator = validator as HeaderValidator;

        for (const [index, schema] of headerValidator.schema.entries()) {
          const select = header[index];

          headerValidate(schema, select, errors, name, context);
        }

        break;
      }
      case ValidatorType.RowCount: {
        const rowCountValidator = validator as RowCountValidator;

        if (typeof rowCountValidator.value === "object") {
          const headerSelect = rowCountValidator.value;

          const value = header[headerSelect.headerIndex] as number;

          if (sheetJSON.length < value || sheetJSON.length > value) {
            errors.push({
              error: rowCountValidator.errorText || "Row Count does not match",
              rule: name
            });
          }
        }

        if (typeof rowCountValidator.value === "number") {
          if (sheetJSON.length < rowCountValidator.value || sheetJSON.length > rowCountValidator.value) {
            errors.push({
              error: rowCountValidator.errorText || "Row Count does not match",
              rule: name
            });
          }
        }

        break;
      }
      case ValidatorType.typeFieldCheck: {
        const typeFieldValidator = validator as TypeFieldValidator;

        for (const [index, schema] of typeFieldValidator.schema.entries()) {
          switch (schema.type) {
            case "select": {
              const select = schema as TypeFieldSchema;

              if (!select?.value) {
                errors.push({
                  error: "invalid validation schema index:" + index
                });
                continue;
              }

              const value = select.value as HeaderSelect;

              if (!value?.field) {
                errors.push({
                  error: "invalid validation schema index:" + index
                });
                continue;
              }

              const selectValue = header[value.headerIndex]?.trim();

              if (!selectValue) {
                errors.push({
                  error: "invalid validation schema index:" + index
                });
                continue;
              }

              if (Array.isArray(select.value) && !select.value.some((val) => val === selectValue)) {
                errors.push({
                  error: schema.errorText || "Failed to match file value to required values" + schema.name
                });
              } else if (!selectValue.includes(context?.[value.field as string] || "")) {
                errors.push({
                  error: schema.errorText || "Failed to match file value to required value" + schema.name
                });
              }

              break;
            }
          }
        }
      }
    }
  }
}
