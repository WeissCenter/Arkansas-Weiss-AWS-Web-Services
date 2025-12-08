import { DynamoDBValidationTemplate } from "../../libs/validation/src/lib/types";

const template: DynamoDBValidationTemplate = {
  "type": "ValidationTemplate",
  "id": "ID#FS901",
  "name": "General FS901 Spec Validator",
  "rules": [
    {
      "name": "Header Validate",
      "validator": {
        "type": "header",
        "schema": [
          {
            "type": "string",
            "array": true,
            "errorType": "WrongFile",
            "name": "file-type",
            "value": ["SEA INFANT TODD (IDEA C) EXIT", "LEA INFANT TODD (IDEA C) EXIT"]
          },
          {
            "type": "number",
            "errorType": "NumberOfRecords",
            "name": "total-records-in-file"
          },
          {
            "type": "string",
            "errorType": "FileHeader",
            "maxLength": 25,
            "name": "file-name",
            "regex": "^[A-Z]{2}(SEA|LEA)IDEACEXIT[A-Za-z0-9]{0,7}(\\.csv)$"
          },
          {
            "type": "string",
            "name": "file-identifier"
          },
          {
            "type": "string",
            "errorType": "FileHeader",
            "name": "file-reporting-period",
            "regex": "^\\d{4}[- ]\\d{4}$"
          },
          {
            "type": "string",
            "maxLength": 0,
            "name": "filler"
          }
        ]
      }
    },
    {
      "name": "Row Count Validate",
      "validator": {
        "type": "rowCount",
        "errorType": "NumberOfRecords",
        "value": {
          "headerIndex": 1
        }
      }
    },
    {
      "name": "Validate Year",
      "validator": {
        "type": "typeFieldCheck",
        "schema": [
          {
            "name": "Year Check",
            "errorType": "DifferentYear",
            "type": "select",
            "field": "reportingYear",
            "value": {
              "headerIndex": 4
            }
          }
        ]
      }
    }
  ]
}

export default template;
