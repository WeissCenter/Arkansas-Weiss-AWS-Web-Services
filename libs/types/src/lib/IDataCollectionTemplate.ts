export interface IDataCollectionTemplate {
  id: string;
  name: string;
  description: string;
  fields: DataCollectionFieldDefinition[];
  files: DataCollectionFileDefinition[];
}

export interface DataCollectionFieldDefinition {
  shortLabel: string;
  id: string;
  label: string;
  default?: any;
  required?: boolean;
  type: DataCollectionFieldType;
  options: any[];
}

export enum DataCollectionFieldType {
  SELECT = "select",
  TEXT = "text"
}

export interface DataCollectionFileCondition {
  field: string;
  operation: "neq" | "eq" | "contains";
  value: any;
}

export type DataParseDefinitionFrom = "html" | "csv";

export interface ConfigRowMapping {
  field: string;
  index: number;
  value?: boolean;
  label?: string;
  children?: ConfigRowMapping[];
}
export interface ConfigGroup {
  id: string;
  rowMapping: ConfigRowMapping[];
}

export interface DataParseDefinitionConfig {
  header: string[];
  groups?: ConfigGroup[];
}

export interface DataParseDefinition {
  from: DataParseDefinitionFrom;
  config: DataParseDefinitionConfig;
}

export interface DataCollectionFileDefinition {
  id: string;
  name: string;
  description: string;
  conditions: DataCollectionFileCondition[];
  validation?: string;
  previewHeaders?: string[];
  dataParse?: DataParseDefinition;
  database?: {
    query: string;
  };
}

// {
//     "name": "Child Count",
//     "description": "For creating Child Count (Part B) reports, States/entities are required to report the Child Count data under Title 1, Part A, Subsection 618 of IDEA.",
//     "fields": [
//         {
//             "id": "reportingYear",
//             "label": "For what reporting year?",
//             "type": "select",
//             "options": [
//                 {
//                     "label": "2022-2023",
//                     "value": "2022-2023"
//                 }
//             ]
//         }
//     ],
//     "files":[
//         {
//             "name": "FS002 - Children with Disabilities (IDEA) School Age",
//             "description": "",
//             "validation": "FS002"
//         },
//         {
//             "name": "FS089 - Children with Disabilities (IDEA) Early Childhood",
//             "description": "",
//             "validation": "FS089"
//         }
//     ]
// }
