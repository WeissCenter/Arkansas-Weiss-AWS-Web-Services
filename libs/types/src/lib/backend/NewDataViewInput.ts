import { DataParseDefinition } from "../IDataCollectionTemplate";
import { SQLJoinType } from "../SQLJoinType";
import { DataSetDataSource, DataSetDataSourceRelationship } from "./DataSet";

export interface NewDataViewInput {
  dataViewID?: string;
  name: string;
  description: string;
  type?: "collection" | "file" | "database";
  dataViewType?: "collection" | "file" | "database";
  reportingYear?: string;
  data: DBDataViewDataCollection;
}

export interface DBDataViewDataCollection {
  id: string;
  dataSource?: string;
  fields: DataViewField[];
  files: {
    id: string;
    database?: { query: string };
    dataParse?: DataParseDefinition;
    location: string;
    errors?: any;
  }[];
}

export interface DataViewField {
  id: string;
  label: string;
  value: any;
}

// {
//     "id": "childCount",
//     "fields": [
//         {
//             "id": "reportingYear",
//             "value": "2022-2023"
//         }
//     ],
//     "files":[ //13123/FS089/FS089.csv
//         {
//             "id": "FS089",
//             "location": ""
//         },
//         {
//             "id": "FS002",
//             "location": ""
//         }
//     ]
// }
