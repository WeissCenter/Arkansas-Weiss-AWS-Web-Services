import { DynamoDBValidationTemplate } from "../../libs/validation/src/lib/types";

const template: DynamoDBValidationTemplate = {
  "type": "ValidationTemplate",
  "id": "ID#FS089",
  "description": "",
  "fields": "",
  "files": "",
  "filters": "",
  "metaTags": "",
  "multiFile": "",
  "name": "General FS089 Spec Validator",
  "pages": "",
  "rules": [
    {
      "name": "Header Validate",
      "validator": {
        "type": "header",
        "schema": [
          {
            "name": "file-type",
            "errorType": "WrongFile",
            "type": "string",
            "array": true,
            "value": ["SEA CHILDREN WITH DISABILITIES (IDEA) EC"]
          },
          {
            "type": "number",
            "name": "total-records-in-file",
            "errorType": "NumberOfRecords"
          },
          {
            "name": "file-name",
            "errorType": "FileHeader",
            "regex": "^[A-Z]{2}(SEA|LEA|SCH)CHDSBERL[A-Za-z0-9]{0,7}(\\.csv)$",
            "type": "string",
            "maxLength": 25
          },
          {
            "type": "string",
            "name": "file-identifier"
          },
          {
            "name": "file-reporting-period",
            "errorType": "FileHeader",
            "regex": "^\\d{4}[- ]\\d{4}$",
            "type": "string"
          },
          {
            "type": "string",
            "name": "filler",
            "maxLength": 0
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
  ],
  "sortableCategories": "",
  "suppression": "",
  "title": ""
}

export default template;
