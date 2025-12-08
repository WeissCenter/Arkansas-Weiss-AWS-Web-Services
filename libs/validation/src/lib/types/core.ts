import { Validator } from "./validators";

// ============================================================================
// Core Validation Types
// ============================================================================

/**
 * HTML element selector for extracting values from HTML documents
 */
export type ValidationElement = {
  tag: keyof HTMLElementTagNameMap;
  class?: string;
  id?: string;
  index?: number;
};

/**
 * A single validation rule with a name and validator configuration
 */
export type ValidationRule = {
  name: string;
  validator: Validator;
};

/**
 * Top-level validation template containing multiple rules
 */
export type ValidationTemplate = {
  name: string;
  rules: ValidationRule[];
};

export type DynamoDBValidationTemplate = ValidationTemplate & {
  type: "ValidationTemplate";
  id: string;
  description?: string; // TODO: determine if used
  fields?: string; // TODO: determine if used
  files?: string; // TODO: determine if used
  filters?: string; // TODO: determine if used
  metaTags?: string; // TODO: determine if used
  multiFile?: string; // TODO: determine if used
  pages?: string; // TODO: determine if used
  sortableCategories?: string; // TODO: determine if used
  suppression?: string; // TODO: determine if used
  title?: string; // TODO: determine if used
};

/**
 * Error returned from validation with optional context
 */
export type ValidationError = {
  error: ValidationTemplateError;
  context?: string;
  schema?: string;
  rule?: string;
  message?: typeof VALIDATION_TEMPLATE_ERRORS[ValidationTemplateError];
};

export const validateReportingYear = (reportingYear: string, expectedValue: string) => {
  let numericExpectedValue = Number(expectedValue);
  let previousNumericExpectedValue: number = numericExpectedValue - 1;

  const htmlExpected = reportingYear === `Year: ${previousNumericExpectedValue}-${String(numericExpectedValue).slice(-2)}`;
  const headerDashExpected = reportingYear === `${previousNumericExpectedValue}-${numericExpectedValue}`;
  const headerSpaceExpected = reportingYear === `${previousNumericExpectedValue} ${numericExpectedValue}`;

  // console.log('Validating Reporting Year:', { reportingYear, expectedValue, htmlExpected, headerDashExpected, headerSpaceExpected, validReportingYear : htmlExpected || headerDashExpected || headerSpaceExpected });

  return htmlExpected || headerDashExpected || headerSpaceExpected;
}

/**
 * Predefined validation template error messages
 */
export const VALIDATION_TEMPLATE_ERRORS = {
  WrongFile: "The system has recognized that you have uploaded the wrong file.",
  DifferentReportingLevel: "The system has recognized an error regarding the reporting level. Please check the reporting level in the file and try again.",
  DifferentYear: "The system has recognized an error regarding the fiscal year. Please make sure the fiscal year entered matches the year specified in the file and try again.",
  NumberOfRecords: "The system has encountered an error regarding the number of records in this file. The file did not have the same number of records as specified in the header.",
  FileHeader: "The system has detected that one or more columns in the header record exceed the maximum allowed character length. Please review the header values and ensure no column exceeds the character limit and try again.",
  Unknown: "The system has encountered an unknown error while loading your data.",
  Connection: "The system has encountered an error connecting to your data source.",
  Timeout: "The system has identified that you have been idle for an extended period of time, and you have been timed out of your session."
} as const;

export type ValidationTemplateError = keyof typeof VALIDATION_TEMPLATE_ERRORS;
export const DEFAULT_ERROR_TYPE: ValidationTemplateError = "Unknown";
export const DEFAULT_ERROR_MESSAGE = VALIDATION_TEMPLATE_ERRORS[DEFAULT_ERROR_TYPE];

export const createDefaultValidationError = (context?: string, schema?: string, rule?: string): ValidationError => {
  const defaultError: ValidationError = {
    error: DEFAULT_ERROR_TYPE,
    message: VALIDATION_TEMPLATE_ERRORS[DEFAULT_ERROR_TYPE],
  };
  if (context) defaultError.context = context;
  if (schema) defaultError.schema = schema;
  if (rule) defaultError.rule = rule;
  return defaultError;
};