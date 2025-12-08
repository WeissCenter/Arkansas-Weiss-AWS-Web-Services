/**
 * Test fixtures for validation library
 */

import * as XLSX from "xlsx";
import type {
  ValidationTemplate,
  StringSchema,
  NumberSchema,
  SelectSchema,
  HeaderSelect,
} from "../types";

// ============================================================================
// Schema Fixtures
// ============================================================================

export const stringSchema: StringSchema = {
  type: "string",
  name: "test-string",
  value: "expected-value",
};

export const stringArraySchema: StringSchema = {
  type: "string",
  name: "test-string-array",
  array: true,
  value: ["value1", "value2", "value3"],
};

export const stringRegexSchema: StringSchema = {
  type: "string",
  name: "test-regex",
  regex: "^[A-Z]{2}\\d{3}$",
};

export const stringMaxLengthSchema: StringSchema = {
  type: "string",
  name: "test-maxlength",
  maxLength: 10,
};

export const numberSchema: NumberSchema = {
  type: "number",
  name: "test-number",
  min: 0,
  max: 100,
};

export const selectArraySchema: SelectSchema = {
  type: "select",
  name: "test-select-array",
  field: "testField",
  value: ["option1", "option2", "option3"],
};

export const headerSelect: HeaderSelect = {
  headerIndex: 2,
  substring: {
    start: 2,
    end: 5,
  },
};

export const selectHeaderSchema: SelectSchema = {
  type: "select",
  name: "test-select-header",
  field: "reportingLevel",
  value: headerSelect,
};

// ============================================================================
// Validation Template Fixtures
// ============================================================================

export const csvValidationTemplate: ValidationTemplate = {
  name: "CSV Test Template",
  rules: [
    {
      name: "Header Validation",
      validator: {
        type: "header",
        schema: [
          {
            type: "string",
            name: "file-type",
            errorType: "WrongFile",
            array: true,
            value: ["SEA CHILDREN WITH DISABILITIES"],
          },
          {
            type: "number",
            name: "total-records",
            errorType: "NumberOfRecords",
          },
          {
            type: "string",
            name: "file-name",
            errorType: "FileHeader",
            regex: "^[A-Z]{2}(SEA|LEA|SCH).*\\.csv$",
          },
        ],
      },
    },
    {
      name: "Row Count Validation",
      validator: {
        type: "rowCount",
        errorType: "NumberOfRecords",
        value: { headerIndex: 1 },
      },
    },
    {
      name: "Reporting Level Validation",
      validator: {
        type: "typeFieldCheck",
        schema: [
          {
            type: "select",
            name: "reporting-level",
            field: "reportingLevel",
            errorType: "DifferentReportingLevel",
            value: {
              headerIndex: 2,
              substring: { start: 2, end: 5 },
            },
          },
        ],
      },
    },
  ],
};

export const htmlValidationTemplate: ValidationTemplate = {
  name: "HTML Test Template",
  rules: [
    {
      name: "HTML Header Validation",
      validator: {
        type: "headerHTML",
        schema: [
          {
            type: "string",
            name: "title",
            element: {
              tag: "h1",
              class: "page-title",
            },
            value: "Expected Title",
          },
        ],
      },
    },
    {
      name: "HTML Type Field Check",
      validator: {
        type: "typeFieldCheckHTML",
        schema: [
          {
            type: "string",
            name: "content",
            element: {
              tag: "div",
              id: "content",
            },
            regex: "^[A-Za-z0-9\\s]+$",
          },
        ],
      },
    },
  ],
};

// ============================================================================
// CSV Data Fixtures
// ============================================================================

export function createCSVWorkbook(
  header: any[],
  rows: any[][] = []
): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

export const validCSVHeader = [
  "SEA CHILDREN WITH DISABILITIES",
  10,
  "NYSEACWDBLIDEAFS002.csv",
  "FS002",
  "2023-2024",
  "",
];

export const validCSVWorkbook = createCSVWorkbook(validCSVHeader, [
  ["row1", "data1", "value1"],
  ["row2", "data2", "value2"],
  ["row3", "data3", "value3"],
  ["row4", "data4", "value4"],
  ["row5", "data5", "value5"],
  ["row6", "data6", "value6"],
  ["row7", "data7", "value7"],
  ["row8", "data8", "value8"],
  ["row9", "data9", "value9"],
  ["row10", "data10", "value10"],
]);

export const invalidCSVWorkbook = createCSVWorkbook(
  ["WRONG FILE TYPE", "not-a-number", "invalid-filename.txt"],
  [["row1", "data1"]]
);

// ============================================================================
// HTML Data Fixtures
// ============================================================================

export const validHTML = `
<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>
    <h1 class="page-title">Expected Title</h1>
    <div id="content">Valid Content 123</div>
  </body>
</html>
`;

export const invalidHTML = `
<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>
    <h1 class="page-title">Wrong Title</h1>
    <div id="content">Invalid@Content!</div>
  </body>
</html>
`;

// ============================================================================
// Context Fixtures
// ============================================================================

export const validContext = {
  reportingLevel: "SEA",
  reportingYear: "2023-2024",
};

export const invalidContext = {
  reportingLevel: "LEA",
  reportingYear: "2022-2023",
};
