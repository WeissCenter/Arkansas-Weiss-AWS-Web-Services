# @adapt/validation

A functional, type-safe validation library for CSV and HTML files using discriminated unions and pure functions.

## Overview

This library provides a flexible validation framework for validating structured data from CSV/Excel files and HTML documents. It uses a template-based approach with discriminated union types for type-safe validation rules.

## Features

- ✅ **Functional Design** - Pure functions with no side effects
- ✅ **Type-Safe** - Full TypeScript support with discriminated unions
- ✅ **Flexible** - Supports CSV, Excel, and HTML validation
- ✅ **Composable** - Easy to combine multiple validation rules
- ✅ **Well-Tested** - 40+ unit and integration tests
- ✅ **Clean API** - Simple, intuitive interface

## Installation

```typescript
import { validate, ValidationTemplate } from '@adapt/validation';
```

## Architecture

The library is organized into clean, focused modules:

```
libs/validation/src/lib/
├── validation.ts          # Main validation logic (537 lines)
└── types/
    ├── index.ts          # Barrel export
    ├── core.ts           # Core types (ValidationTemplate, ValidationError, etc.)
    ├── schemas.ts        # Schema types (StringSchema, NumberSchema, SelectSchema)
    └── validators.ts     # Validator types (HeaderValidator, RowCountValidator, etc.)
```

### Key Concepts

1. **Validation Template** - Top-level configuration with multiple rules
2. **Validation Rules** - Named validation rules with specific validators
3. **Validators** - Different validation strategies (header, rowCount, typeFieldCheck)
4. **Schemas** - Define validation constraints for individual fields

## Usage

### Basic CSV Validation

```typescript
import { validate, ValidationTemplate } from '@adapt/validation';
import * as XLSX from 'xlsx';

const template: ValidationTemplate = {
  name: "CSV Validator",
  rules: [
    {
      name: "Header Validation",
      validator: {
        type: "header",
        schema: [
          {
            type: "string",
            name: "file-type",
            errorText: "Invalid file type",
            value: "SEA CHILDREN WITH DISABILITIES"
          },
          {
            type: "number",
            name: "total-records",
            errorText: "Invalid record count",
            min: 0,
            max: 10000
          }
        ]
      }
    }
  ]
};

const workbook = XLSX.readFile('data.csv');
const errors = validate(workbook, template);

if (errors.length > 0) {
  console.error('Validation errors:', errors);
}
```

### CSV Row Count Validation

```typescript
const template: ValidationTemplate = {
  name: "Row Count Check",
  rules: [
    {
      name: "Row Count",
      validator: {
        type: "rowCount",
        errorText: "Row count doesn't match header value",
        value: { headerIndex: 1 } // Get expected count from header column 1
      }
    }
  ]
};
```

### Type Field Check with Substring

```typescript
const template: ValidationTemplate = {
  name: "Reporting Level Check",
  rules: [
    {
      name: "Validate Reporting Level",
      validator: {
        type: "typeFieldCheck",
        schema: [
          {
            type: "select",
            name: "reporting-level",
            field: "reportingLevel",
            errorText: "Invalid reporting level",
            value: {
              headerIndex: 2,
              field: "reportingLevel",
              substring: { start: 2, end: 5 } // Extract "SEA" from "NYSEACWDBL..."
            }
          }
        ]
      }
    }
  ]
};

const context = { reportingLevel: "SEA" };
const errors = validate(workbook, template, context);
```

### HTML Validation

```typescript
const template: ValidationTemplate = {
  name: "HTML Validator",
  rules: [
    {
      name: "Title Check",
      validator: {
        type: "headerHTML",
        schema: [
          {
            type: "string",
            name: "page-title",
            value: "Expected Title",
            element: {
              tag: "h1",
              class: "page-title"
            }
          }
        ]
      }
    }
  ]
};

const html = '<html><h1 class="page-title">Expected Title</h1></html>';
const errors = validate(html, template);
```

### String Validation Options

```typescript
// Exact match
{
  type: "string",
  name: "exact",
  value: "EXACT_VALUE"
}

// Array of allowed values
{
  type: "string",
  name: "allowed-values",
  array: true,
  value: ["VALUE1", "VALUE2", "VALUE3"]
}

// Regex pattern
{
  type: "string",
  name: "pattern",
  regex: "^[A-Z]{2}\\d{3}$"
}

// Max length
{
  type: "string",
  name: "short-field",
  maxLength: 10
}
```

## Type System

The library uses **discriminated unions** for type-safe validation:

### Validators

```typescript
type Validator =
  | { type: "header"; schema: Schema[] }
  | { type: "headerHTML"; schema: Schema[] }
  | { type: "rowCount"; errorText?: string; value: number | HeaderSelect }
  | { type: "typeFieldCheck"; schema: Schema[] }
  | { type: "typeFieldCheckHTML"; schema: Schema[] };
```

### Schemas

```typescript
type Schema =
  | { type: "string"; name: string; value?: string | string[]; regex?: string; maxLength?: number; array?: boolean; errorText?: string }
  | { type: "number"; name: string; min?: number; max?: number; errorText?: string }
  | { type: "select"; name: string; field: string; value?: string | string[] | HeaderSelect; errorText?: string };
```

This enables TypeScript to automatically narrow types in switch statements!

## Testing

### Running Tests

```bash
# Run all validation tests
npm test -- --testPathPattern=validation

# Run with coverage report
npm test -- --testPathPattern=validation --coverage

# Run specific test file
npm test -- validation.test.ts

# Run in watch mode (auto-rerun on changes)
npm test -- --testPathPattern=validation --watch

# Run tests with verbose output
npm test -- --testPathPattern=validation --verbose
```

### Test Structure

```
libs/validation/src/lib/__tests__/
├── fixtures.ts           # Test data and utilities
├── validation.test.ts    # Core validation tests (28 tests)
└── edge-cases.test.ts    # Edge case tests (12 tests)
```

### Test Coverage

- ✅ **38 passing tests**
- 📊 **40 total test cases**
- ⏱️ **~3 second runtime**

**Coverage Areas:**
- CSV header validation (string, number, regex, max length, arrays)
- CSV row count validation (fixed, from header)
- Type field checks with substring extraction
- HTML element selection and validation
- Edge cases (empty data, boundaries, special characters, whitespace)
- Error handling and custom error messages

### Writing New Tests

Tests use Jest and follow this pattern:

```typescript
import { validate } from "../validation";
import type { ValidationTemplate } from "../types";
import * as fixtures from "./fixtures";

describe("My Feature", () => {
  it("should validate correctly", () => {
    const template: ValidationTemplate = {
      name: "Test",
      rules: [
        {
          name: "My Rule",
          validator: {
            type: "header",
            schema: [
              {
                type: "string",
                name: "field",
                value: "EXPECTED"
              }
            ]
          }
        }
      ]
    };

    const workbook = fixtures.createCSVWorkbook(["EXPECTED"]);
    const errors = validate(workbook, template);

    expect(errors).toHaveLength(0);
  });
});
```

### Test Fixtures

Use the fixtures module for test data:

```typescript
import * as fixtures from "./fixtures";

// Create CSV workbook
const workbook = fixtures.createCSVWorkbook(
  ["header1", "header2"],  // Header row
  [["row1", "data1"], ["row2", "data2"]]  // Data rows
);

// Use predefined fixtures
fixtures.validCSVWorkbook
fixtures.invalidCSVWorkbook
fixtures.validHTML
fixtures.invalidHTML
fixtures.csvValidationTemplate
fixtures.htmlValidationTemplate
fixtures.validContext
```

### Adding New Test Cases

1. **Add fixture data** to `fixtures.ts` if needed
2. **Create test file** following naming convention `*.test.ts`
3. **Organize tests** using `describe()` blocks by feature
4. **Write test cases** using `it()` with clear descriptions
5. **Use assertions** with `expect()` for validation

Example:

```typescript
describe("New Feature", () => {
  describe("Sub-feature", () => {
    it("should handle valid input", () => {
      // Arrange
      const template = /* ... */;
      const data = /* ... */;

      // Act
      const errors = validate(data, template);

      // Assert
      expect(errors).toHaveLength(0);
    });

    it("should detect invalid input", () => {
      // Arrange, Act, Assert
      const errors = validate(invalidData, template);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].error).toBe("Expected error message");
    });
  });
});
```

## API Reference

### `validate(data, template, context?)`

Main validation function.

**Parameters:**
- `data: XLSX.WorkBook | string` - CSV/Excel workbook or HTML string
- `template: ValidationTemplate` - Validation configuration
- `context?: Record<string, any>` - Optional context for field validation

**Returns:**
- `ValidationError[]` - Array of validation errors (empty if valid)

### `ValidationError`

```typescript
type ValidationError = {
  error: string;      // Error message
  header?: string;    // Field name (if applicable)
  rule?: string;      // Rule name that failed
};
```

### Validator Types

- `"header"` - Validate CSV header row
- `"headerHTML"` - Validate HTML element values
- `"rowCount"` - Validate number of data rows
- `"typeFieldCheck"` - Validate field values with context
- `"typeFieldCheckHTML"` - Validate HTML field values with context

### Schema Types

- `"string"` - String validation (exact, array, regex, maxLength)
- `"number"` - Number validation (min, max)
- `"select"` - Context-based field validation

## Development

### Building

```bash
npm run build
```

### Type Checking

```bash
npx tsc --noEmit
```

### Project Structure

The library follows a **functional programming** approach:

- **Pure functions** - All validation functions return errors, no mutations
- **Discriminated unions** - Type-safe validator and schema types
- **Composable** - Easy to combine multiple validators
- **Immutable** - No shared state or side effects

## Recent Improvements

### Refactoring (October 2024)

1. **Type System** - Converted interfaces to types, removed enums, added discriminated unions
2. **Functional Style** - Refactored from imperative (mutations) to functional (pure functions)
3. **Organization** - Reduced from 16 files to 5 files, removed redundant types
4. **Readability** - Clear separation of concerns, ~110 fewer lines
5. **Testing** - Added comprehensive test suite with 40 test cases

### Benefits

- ✅ **Better Type Inference** - TypeScript automatically narrows types in switch statements
- ✅ **No Side Effects** - All functions are pure with explicit returns
- ✅ **Easier Testing** - Pure functions are simple to test
- ✅ **Better Organization** - Clear file structure with logical grouping
- ✅ **More Maintainable** - Each function has single responsibility

## Contributing

When contributing to this library:

1. **Write tests** for new features
2. **Use pure functions** with no side effects
3. **Follow type patterns** with discriminated unions
4. **Update types** in the appropriate file (core, schemas, validators)
5. **Run tests** before committing

## License

This library is part of the ADAPT CDK project.
