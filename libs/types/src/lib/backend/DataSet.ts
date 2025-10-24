import { DataCollectionFieldDefinition, DataCollectionFileDefinition } from "../IDataCollectionTemplate";
import { SQLJoinType } from "../SQLJoinType";
import { DataSourceStatus } from "./DataSourceStatus";

export interface DataSet {
  type?: string;
  id?: string;
  dataSetID: string;
  name: string;
  description: string;
  author?: string;
  lastPull?: string;
  pulledBy?: string;
  dataFile?: string;
  created: number;
  summaryTemplate?: string;
  dataSources: DataSetDataSource[];
  dataSourceRelationships: DataSetDataSourceRelationship[];
}

export interface DataSetDataSource {
  dataSource: string;
  table?: string;
  sheet?: string;
  schema?: string;
  query?: string;
}

export interface DataSetDataSourceRelationship {
  joinType: SQLJoinType;
  fromField: string;
  toField: string;
}

export interface DataCollectionTemplate {
  type?: string;
  id?: string;
  name: string;
  description: string;
  fields: DataCollectionFieldDefinition[];
  files: DataCollectionFileDefinition[];
}
