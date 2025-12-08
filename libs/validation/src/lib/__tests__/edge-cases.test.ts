/**
 * Edge case tests for validation library
 */

import { validate } from "../validation";
import type { ValidationTemplate } from "../types";
import * as fixtures from "./fixtures";

describe("Edge Cases", () => {
  describe("Empty Data", () => {
    it("should handle empty CSV", () => {
      const template: ValidationTemplate = {
        name: "Empty CSV Test",
        rules: [
          {
            name: "Header Check",
            validator: {
              type: "header",
              schema: [],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook([]);
      const errors = validate(workbook, template);

      expect(errors).toHaveLength(0);
    });

    it("should handle empty validation rules", () => {
      const template: ValidationTemplate = {
        name: "Empty Rules",
        rules: [],
      };

      const workbook = fixtures.createCSVWorkbook(["header"]);
      const errors = validate(workbook, template);

      expect(errors).toHaveLength(0);
    });
  });

  describe("Boundary Values", () => {
    it("should handle zero max length", () => {
      const template: ValidationTemplate = {
        name: "Zero MaxLength",
        rules: [
          {
            name: "Empty String Check",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "empty-field",
                  maxLength: 0,
                },
              ],
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook([""]);
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook(["nonempty"]);
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors).toHaveLength(1);
    });

    it("should handle negative and zero in number ranges", () => {
      const template: ValidationTemplate = {
        name: "Number Range",
        rules: [
          {
            name: "Negative Numbers",
            validator: {
              type: "header",
              schema: [
                {
                  type: "number",
                  name: "num",
                  min: -100,
                  max: 0,
                },
              ],
            },
          },
        ],
      };

      const validWorkbook = fixtures.createCSVWorkbook([-50]);
      const validErrors = validate(validWorkbook, template);
      expect(validErrors).toHaveLength(0);

      const invalidWorkbook = fixtures.createCSVWorkbook([50]);
      const invalidErrors = validate(invalidWorkbook, template);
      expect(invalidErrors.length).toBeGreaterThan(0);
    });
  });

  describe("Special Characters", () => {
    it("should handle special characters in strings", () => {
      const template: ValidationTemplate = {
        name: "Special Chars",
        rules: [
          {
            name: "Special String",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "special",
                  value: "Test@#$%^&*()_+-={}[]|:;<>?,./",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook([
        "Test@#$%^&*()_+-={}[]|:;<>?,./",
      ]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });

    it("should handle unicode characters", () => {
      const template: ValidationTemplate = {
        name: "Unicode Test",
        rules: [
          {
            name: "Unicode String",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "unicode",
                  value: "Hello 世界 🌍",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["Hello 世界 🌍"]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });
  });

  describe("Whitespace Handling", () => {
    it("should trim whitespace from string values", () => {
      const template: ValidationTemplate = {
        name: "Whitespace Test",
        rules: [
          {
            name: "Trimmed String",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "trimmed",
                  value: "VALUE",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["  VALUE  "]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });

    it("should handle newlines and tabs", () => {
      const template: ValidationTemplate = {
        name: "Whitespace Chars",
        rules: [
          {
            name: "Whitespace String",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "whitespace",
                  regex: "^[\\s\\S]+$",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["Line1\nLine2\tTabbed"]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });
  });

  describe("Type Coercion", () => {
    it("should convert numbers to strings for string validation", () => {
      const template: ValidationTemplate = {
        name: "Number to String",
        rules: [
          {
            name: "String Check",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "num-as-string",
                  value: "123",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook([123]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });

    it("should reject non-numbers for number validation", () => {
      const template: ValidationTemplate = {
        name: "Not a Number",
        rules: [
          {
            name: "Number Check",
            validator: {
              type: "header",
              schema: [
                {
                  type: "number",
                  name: "not-num",
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["not-a-number"]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe("Unknown");
    });
  });

  describe("Substring Edge Cases", () => {
    it("should handle substring at string boundaries", () => {
      const template: ValidationTemplate = {
        name: "Substring Boundary",
        rules: [
          {
            name: "Boundary Check",
            validator: {
              type: "typeFieldCheck",
              schema: [
                {
                  type: "select",
                  name: "substring",
                  field: "value",
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

      const workbook = fixtures.createCSVWorkbook(["ABCDEF"]);
      const errors = validate(workbook, template, { value: "ABC" });
      expect(errors).toHaveLength(0);
    });

    it("should handle substring without end index", () => {
      const template: ValidationTemplate = {
        name: "Substring No End",
        rules: [
          {
            name: "Open-ended Substring",
            validator: {
              type: "typeFieldCheck",
              schema: [
                {
                  type: "select",
                  name: "substring",
                  field: "value",
                  value: {
                    headerIndex: 0,
                    substring: { start: 2 },
                  },
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["ABCDEF"]);
      const errors = validate(workbook, template, { value: "CDEF" });
      expect(errors).toHaveLength(0);
    });

    it("should handle empty substring result", () => {
      const template: ValidationTemplate = {
        name: "Empty Substring",
        rules: [
          {
            name: "Empty Result",
            validator: {
              type: "typeFieldCheck",
              schema: [
                {
                  type: "select",
                  name: "substring",
                  field: "value",
                  value: {
                    headerIndex: 0,
                    substring: { start: 0, end: 0 },
                  },
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["ABC"]);
      const errors = validate(workbook, template, { value: "" });
      expect(errors).toHaveLength(1);
    });
  });

  describe("Array Operations", () => {
    it("should handle single element arrays", () => {
      const template: ValidationTemplate = {
        name: "Single Element",
        rules: [
          {
            name: "Array Check",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "single",
                  array: true,
                  value: ["ONLY_VALUE"],
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["ONLY_VALUE"]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });

    it("should handle large arrays", () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => `VALUE_${i}`);
      const template: ValidationTemplate = {
        name: "Large Array",
        rules: [
          {
            name: "Large Array Check",
            validator: {
              type: "header",
              schema: [
                {
                  type: "string",
                  name: "large",
                  array: true,
                  value: largeArray,
                },
              ],
            },
          },
        ],
      };

      const workbook = fixtures.createCSVWorkbook(["VALUE_500"]);
      const errors = validate(workbook, template);
      expect(errors).toHaveLength(0);
    });
  });

  describe("HTML Edge Cases", () => {
    it("should handle malformed HTML", () => {
      const template: ValidationTemplate = {
        name: "Malformed HTML",
        rules: [],
      };

      const html = "<div><p>Unclosed tags";
      const errors = validate(html, template);
      // cheerio is lenient, should not crash
      expect(Array.isArray(errors)).toBe(true);
    });

    it("should handle HTML with nested elements", () => {
      const template: ValidationTemplate = {
        name: "Nested Elements",
        rules: [
          {
            name: "Nested Check",
            validator: {
              type: "headerHTML",
              schema: [
                {
                  type: "string",
                  name: "nested",
                  value: "Inner Text",
                  element: {
                    tag: "span",
                    class: "inner",
                  },
                },
              ],
            },
          },
        ],
      };

      const html = `
        <div>
          <div>
            <span class="inner">Inner Text</span>
          </div>
        </div>
      `;
      const errors = validate(html, template);
      expect(errors).toHaveLength(0);
    });

    it("should handle multiple elements with same selector", () => {
      const template: ValidationTemplate = {
        name: "Multiple Elements",
        rules: [
          {
            name: "First Element",
            validator: {
              type: "headerHTML",
              schema: [
                {
                  type: "string",
                  name: "first",
                  value: "First",
                  element: {
                    tag: "p",
                    class: "item",
                    index: 0,
                  },
                },
              ],
            },
          },
        ],
      };

      const html = `
        <p class="item">First</p>
        <p class="item">Second</p>
        <p class="item">Third</p>
      `;
      const errors = validate(html, template);
      expect(errors).toHaveLength(0);
    });
  });
});
