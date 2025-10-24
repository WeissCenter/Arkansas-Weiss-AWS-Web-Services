import { DataSourceStatus } from "./DataSourceStatus";
import { DataSourceType } from "./DataSourceType";
import { SQLType } from "./SQLType";

export interface DataSource {
  dataSourceID?: string;
  name: string;
  description?: string;
  source?: string;
  fileSpec?: string;
  author?: string;
  updated?: number;
  sourceType?: DataSourceType;
  metadata?: Record<string, any>;
  path: string;
  fileType?: DataSourceFileType;
  dataFiles?: string[];
  lastPull?: string;
  validFile?: boolean;
  fileErrors?: { error: string; header: string; id: string }[];
  connectionInfo: string | DataSourceConnectionInfo; // secret manager id
}

export enum DataSourceFileType {
  CSV = "csv",
  EXCEL = "excel"
}

export type DataSourceConnectionInfo = {
  type: SQLType;
  database: string;
  port: number;
  username: string;
  password: string;
};
