import * as sql from "mssql";
export interface DatabaseRequestTemplate {
  code: string;
  name: string;
  description: string;
  request: (connection: sql.ConnectionPool, datasourceID: string, ...args: any[]) => Promise<string[]>;
}
