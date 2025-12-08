import { ValidationTemplateError } from "./core";

// Base properties shared by all schemas
type BaseSchema = {
  name: string;
  errorType?: ValidationTemplateError;
  element?: {
    tag: keyof HTMLElementTagNameMap;
    class?: string;
    id?: string;
    index?: number;
  };
};

// String validation schema
export type StringSchema = BaseSchema & {
  type: "string";
  value?: string | string[];
  regex?: string;
  maxLength?: number;
  array?: boolean;
};

// Number validation schema
export type NumberSchema = BaseSchema & {
  type: "number";
  max?: number;
  min?: number;
};

// Header select configuration for extracting values from CSV headers
export type HeaderSelect = {
  headerIndex: number;
  substring?: {
    start: number;
    end?: number;
  };
};

// Select validation schema (used in typeFieldCheck validators)
export type SelectSchema = BaseSchema & {
  type: "select";
  field: string;
  value?: string | string[] | HeaderSelect;
  regex?: string;
  maxLength?: number;
  array?: boolean;
};

// Discriminated union of all schema types
export type Schema = StringSchema | NumberSchema | SelectSchema;
