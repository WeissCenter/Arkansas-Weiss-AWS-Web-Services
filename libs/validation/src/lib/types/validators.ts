import { ValidationTemplateError } from "./core";
import { Schema, HeaderSelect } from "./schemas";

// Header validator for CSV files
export type HeaderValidator = {
  type: "header";
  schema: Schema[];
};

// Header validator for HTML files
export type HeaderHTMLValidator = {
  type: "headerHTML";
  schema: Schema[];
};

// Row count validator
export type RowCountValidator = {
  type: "rowCount";
  errorType?: ValidationTemplateError;
  value: number | HeaderSelect;
};

// Type field check validator for CSV files
export type TypeFieldCheckValidator = {
  type: "typeFieldCheck";
  errorType?: ValidationTemplateError;
  schema: Schema[];
};

// Type field check validator for HTML files
export type TypeFieldCheckHTMLValidator = {
  type: "typeFieldCheckHTML";
  errorType?: ValidationTemplateError;
  schema: Schema[];
};

// Discriminated union of all validator types
export type Validator =
  | HeaderValidator
  | HeaderHTMLValidator
  | RowCountValidator
  | TypeFieldCheckValidator
  | TypeFieldCheckHTMLValidator;
