import { DynamoDBValidationTemplate } from "../../libs/validation/src/lib/types";

const template: DynamoDBValidationTemplate = {
  "type": "ValidationTemplate",
  "id": "ID#childCountAndSettings",
  "description": "",
  "fields": "",
  "files": "",
  "filters": "",
  "metaTags": "",
  "multiFile": "",
  "name": "General IDEA Part C Child Count and Settings Spec Validator",
  "pages": "",
  "rules": [
    {
      "name": "Header Validate",
      "validator": {
        "type": "headerHTML",
        "schema": [
          {
            "name": "state-name",
            "errorType": "WrongFile",
            "type": "string",
            "element": {
              "index": 0,
              "tag": "h1"
            }
          },
          {
            "name": "file-type",
            "errorType": "WrongFile",
            "regex": "IDEA Part C - Child Count and Settings Release \\d+\\.\\d+",
            "type": "string",
            "element": {
              "index": 1,
              "tag": "h1"
            }
          },
          {
            "name": "year",
            "errorType": "WrongFile",
            "regex": "Year: \\d{4}-\\d{2}",
            "type": "string",
            "element": {
              "index": 2,
              "tag": "h1"
            }
          }
        ]
      }
    },
    {
      "name": "Validate Year",
      "validator": {
        "type": "typeFieldCheckHTML",
        "schema": [
          {
            "name": "Year Check",
            "errorType": "DifferentYear",
            "type": "select",
            "field": "reportingYear",
            "value": "reportingYear",
            "element": {
              "index": 2,
              "tag": "h1"
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
