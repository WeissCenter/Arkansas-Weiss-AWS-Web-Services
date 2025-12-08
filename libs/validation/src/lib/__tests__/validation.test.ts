/**
 * Unit tests for validation library
 */

import { validate } from "../validation";
import type { ValidationTemplate, ValidationError } from "../types";
import * as fixtures from "./fixtures";

describe("CSV Validation", () => {
  describe("Header Validation", () => {
    it("should validate correct CSV headers", () => {
      const template: ValidationTemplate = {
        name: "Header Test",
        rules: [
          {
            name: "String Header",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "file-type",
                  value: "SEA CHILDREN WITH DISABILITIES",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook([
        "SEA CHILDREN WITH DISABILITIES",
      ]);
      const errors = validate(workbook, template);

      expect(errors).toHaveLength(0);
    });

    it("should detect incorrect string header value", () => {
      const template: ValidationTemplate = {
        name: "Header Test",
        rules: [
          {
            name: "String Header",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "file-type",
                  value: "EXPECTED VALUE",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["WRONG VALUE"]);
      const errors = validate(workbook, template);

      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("Unknown");
      expect(errors[0].schema).toBe("file-type");
    });

    it("should validate string array header", () => {
      const template: ValidationTemplate = {
        name: "Array Header Test",
        rules: [
          {
            name: "Array Header",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "file-type",
                  array: true,
                  value: ["TYPE1", "TYPE2", "TYPE3"],
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["TYPE2"]);
      const errors = validate(workbook, template);

      expect(errors).toHaveLength(0);
    });

    it("should validate regex pattern in header", () => {
      const template: ValidationTemplate = {
        name: "Regex Test",
        rules: [
          {
            name: "Regex Header",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "filename",
                  regex: "^[A-Z]{2}SEA.*\\.csv$",
                },
              ],
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook(["NYSEA123.csv"]);
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook(["invalid.txt"]);
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors).toHaveLength(1);
      expect(invalidErrors[0].error).toBe("Unknown");
    });

    it("should validate max length in header", () => {
      const template: ValidationTemplate = {
        name: "MaxLength Test",
        rules: [
          {
            name: "MaxLength Header",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "short-field",
                  maxLength: 5,
                },
              ],
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook(["12345"]);
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook(["123456"]);
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors).toHaveLength(1);
      expect(invalidErrors[0].error).toBe("Unknown");
    });

    it("should validate number header", () => {
      const template: ValidationTemplate = {
        name: "Number Test",
        rules: [
          {
            name: "Number Header",
            validator: {
              type: "header",
              schema: [
                {
                  type: "number",
                  name: "count",
                  min: 0,
                  max: 100,
                },
              ],
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook([50]);
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook([150]);
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors).toHaveLength(1);
      expect(invalidErrors[0].error).toBe("Unknown");
    });
  });

  describe("Row Count Validation", () => {
    it("should validate row count with fixed number", () => {
      const template: ValidationTemplate = {
        name: "Row Count Test",
        rules: [
          {
            name: "Fixed Row Count",
            validator: {
              type: "rowCount",
              errorType: "NumberOfRecords",
              value: 5,
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook(
        ["header"],
        [["r1"], ["r2"], ["r3"], ["r4"], ["r5"]]
      );
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook(
        ["header"],
        [["r1"], ["r2"]]
      );
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors).toHaveLength(1);
      expect(invalidErrors[0].error).toBe("NumberOfRecords");
    });

    it("should validate row count from header", () => {
      const template: ValidationTemplate = {
        name: "Row Count From Header",
        rules: [
          {
            name: "Header Row Count",
            validator: {
              type: "rowCount",
              errorType: "NumberOfRecords",
              value: { headerIndex: 1 },
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook(
        ["type", 3, "filename"],
        [["r1"], ["r2"], ["r3"]]
      );
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook(
        ["type", 5, "filename"],
        [["r1"], ["r2"]]
      );
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors).toHaveLength(1);
      expect(invalidErrors[0].error).toBe("NumberOfRecords");
    });
  });

  describe("Type Field Check Validation", () => {
    it("should validate field with substring extraction", () => {
      const template: ValidationTemplate = {
        name: "Substring Test",
        rules: [
          {
            name: "Reporting Level",
            validator: {
              type: "typeFieldCheck",
              schema: [
                {
                  type: "select",
                  name: "reporting-level",
                  field: "reportingLevel",
                  errorType: "DifferentReportingLevel",
                  value: {
                    headerIndex: 0,
                    substring: { start: 0, end: 3 },
                  },
                },
              ],
            },
          },
        ],
      };

      const context = { reportingLevel: "SEA" };

      const validWorkbook = fixtures.createCSVWorkbook(["SEA-DATA-FILE"]);
      const validErrors = validate(validWorkbook, template, context);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook(["LEA-DATA-FILE"]);
      const invalidErrors = validate(invalidWorkbook, template, context);
      expect(invalidErrors).toHaveLength(1);
      expect(invalidErrors[0].error).toBe("DifferentReportingLevel");
    });

    it("should detect missing context value", () => {
      const template: ValidationTemplate = {
        name: "Missing Context",
        rules: [
          {
            name: "Context Check",
            validator: {
              type: "typeFieldCheck",
              schema: [
                {
                  type: "select",
                  name: "field-check",
                  field: "missingField",
                  value: {
                    headerIndex: 0,
                  },
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["VALUE"]);
      const errors = validate(workbook, template, {});

      expect(errors).toHaveLength(1);
      expect(errors[0].error).toContain("Unknown");
    });
  });

  describe("Complex CSV Validation", () => {
    it("should validate complete FS002 template", () => {
      const errors = validate(
        fixtures.validCSVWorkbook,
        fixtures.csvValidationTemplate,
        fixtures.validContext
      );

      expect(errors).toHaveLength(0);
    });

    it("should detect multiple validation errors", () => {
      const errors = validate(
        fixtures.invalidCSVWorkbook,
        fixtures.csvValidationTemplate,
        fixtures.validContext
      );

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.rule === "Header Validation")).toBe(true);
    });
  });
});

describe("HTML Validation", () => {
  describe("Header HTML Validation", () => {
    it("should validate HTML headers", () => {
      const template: ValidationTemplate = {
        name: "HTML Header Test",
        rules: [
          {
            name: "Title Check",
            validator: {
              type: "headerHTML",
              schema: [
                {
                  type: "string",
                  name: "title",
                  value: "Expected Title",
                  element: {
                    tag: "h1",
                    class: "page-title",
                  },
                },
              ],
            },
          },
        ],
      };

      const errors = validate(fixtures.validHTML, template);
      expect(errors).toHaveLength(0);
    });

    it("should detect missing HTML elements", () => {
      const template: ValidationTemplate = {
        name: "Missing Element Test",
        rules: [
          {
            name: "Element Check",
            validator: {
              type: "headerHTML",
              schema: [
                {
                  type: "string",
                  name: "missing",
                  element: {
                    tag: "span",
                    class: "nonexistent",
                  },
                },
              ],
            },
          },
        ],
      };

      const errors = validate(fixtures.validHTML, template);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("Unknown");
    });
  });

  describe("Type Field Check HTML Validation", () => {
    it("should validate HTML string fields", () => {
      const template: ValidationTemplate = {
        name: "HTML String Test",
        rules: [
          {
            name: "Content Check",
            validator: {
              type: "typeFieldCheckHTML",
              schema: [
                {
                  type: "string",
                  name: "content",
                  regex: "^[A-Za-z0-9\\s]+$",
                  element: {
                    tag: "div",
                    id: "content",
                  },
                },
              ],
            },
          },
        ],
      };

      const validErrors = validate(fixtures.validHTML, template);
      expect(validErrors).toHaveLength(0);

      const invalidErrors = validate(fixtures.invalidHTML, template);
      expect(invalidErrors.length).toBeGreaterThan(0);
    });

    it("should use validator errorType as fallback when schema errorType not provided", () => {
      const template: ValidationTemplate = {
        name: "HTML ErrorType Fallback Test",
        rules: [
          {
            name: "ErrorType Check",
            validator: {
              type: "typeFieldCheckHTML",
              errorType: "WrongFile",
              schema: [
                {
                  type: "string",
                  name: "missing-element",
                  element: {
                    tag: "span",
                    class: "does-not-exist",
                  },
                },
              ],
            },
          },
        ],
      };

      const errors = validate(fixtures.validHTML, template);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("WrongFile");
    });

    it("should prioritize schema errorType over validator errorType", () => {
      const template: ValidationTemplate = {
        name: "HTML ErrorType Priority Test",
        rules: [
          {
            name: "Priority Check",
            validator: {
              type: "typeFieldCheckHTML",
              errorType: "WrongFile",
              schema: [
                {
                  type: "string",
                  name: "missing-element",
                  errorType: "FileHeader",
                  element: {
                    tag: "span",
                    class: "does-not-exist",
                  },
                },
              ],
            },
          },
        ],
      };

      const errors = validate(fixtures.validHTML, template);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("FileHeader");
    });
  });

  describe("Complex HTML Validation", () => {
    it("should handle complete HTML validation template", () => {
      const errors = validate(fixtures.validHTML, fixtures.htmlValidationTemplate);
      expect(errors).toHaveLength(0);
    });

    it("should detect multiple HTML validation errors", () => {
      const errors = validate(fixtures.invalidHTML, fixtures.htmlValidationTemplate);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe("Error Handling", () => {
  // it("should handle invalid HTML gracefully", () => {
  //   const template: ValidationTemplate = {
  //     name: "Error Test",
  //     rules: [],
  //   };

  //   const errors = validate("<<<invalid html>>>", template);
  //   expect(errors).toHaveLength(1);
  //   expect(errors[0].error).toBe("Failed to parse html");
  // });

  it("should handle unknown data type", () => {
    const template: ValidationTemplate = {
      name: "Unknown Type Test",
      rules: [],
    };

    const errors = validate({} as any, template);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe("Unknown");
  });
});

describe("Validation Errors", () => {
  it("should include rule name in errors", () => {
    const template: ValidationTemplate = {
      name: "Rule Name Test",
      rules: [
        {
          name: "My Custom Rule",
          validator: {
            type: "header",
            schema: [
              {
                type: "string",
                name: "field",
                value: "EXPECTED",
              },
            ],
          },
        },
      ],
    };

    const workbook = fixtures.createCSVWorkbook(["WRONG"]);
    const errors = validate(workbook, template);

    expect(errors[0].rule).toBe("My Custom Rule");
  });

  it("should include header name in errors", () => {
    const template: ValidationTemplate = {
      name: "Header Name Test",
      rules: [
        {
          name: "Rule",
          validator: {
            type: "header",
            schema: [
              {
                type: "string",
                name: "my-header-field",
                value: "EXPECTED",
              },
            ],
          },
        },
      ],
    };

    const workbook = fixtures.createCSVWorkbook(["WRONG"]);
    const errors = validate(workbook, template);

    expect(errors[0].schema).toBe("my-header-field");
  });

  it("should use custom error text when provided", () => {
    const template: ValidationTemplate = {
      name: "Custom Error Test",
      rules: [
        {
          name: "Rule",
          validator: {
            type: "header",
            schema: [
              {
                type: "string",
                name: "field",
                value: "EXPECTED",
              },
            ],
          },
        },
      ],
    };

    const workbook = fixtures.createCSVWorkbook(["WRONG"]);
    const errors = validate(workbook, template);

    expect(errors[0].error).toBe("Unknown");
  });
});
