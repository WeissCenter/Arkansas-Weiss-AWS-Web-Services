// ============================================================================
// Barrel Export - All Validation Types
// ============================================================================

// Core validation types
export type {
  ValidationTemplate,
  DynamoDBValidationTemplate,
  ValidationRule,
  ValidationElement,
  ValidationError,
  ValidationTemplateError,
  VALIDATION_TEMPLATE_ERRORS,
} from "./core";

export { createDefaultValidationError } from "./core";

// Schema types (discriminated union)
export type {
  Schema,
  StringSchema,
  NumberSchema,
  SelectSchema,
  HeaderSelect,
} from "./schemas";

// Validator types (discriminated union)
export type {
  Validator,
  HeaderValidator,
  HeaderHTMLValidator,
  RowCountValidator,
  TypeFieldCheckValidator,
  TypeFieldCheckHTMLValidator,
} from "./validators";
