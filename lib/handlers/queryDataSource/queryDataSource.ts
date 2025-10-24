import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, DataSource, DataSourceType, getDatasourceMetadata, QueryDataSourceInput, SQLType } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import * as sql from "mssql";
import * as pd from "nodejs-polars";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const STAGING_BUCKET = process.env.STAGING_BUCKET || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const secrets = new SecretsManagerClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }
    const queryInput = JSON.parse(event.body) as QueryDataSourceInput;

    const dataSourceID = event.pathParameters?.["dataSourceId"];
    if (!dataSourceID) {
      return CreateBackendErrorResponse(400, "Missing dataSourceID in path parameters");
    }

    const dataSourceMetadata = await getDatasourceMetadata(db as any, TABLE_NAME, dataSourceID);

    if (!dataSourceMetadata) {
      return CreateBackendErrorResponse(404, `Data Source with ID ${dataSourceID} does not exist`);
    }

    switch (dataSourceMetadata.sourceType) {
      case DataSourceType.FILE: {
        return await handleFile(dataSourceMetadata, queryInput);
      }
      case DataSourceType.SQL: {
        return await handleSQL(dataSourceMetadata, secrets, queryInput);
      }
    }
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to query data source");
  }
};

async function handleFile(dataSourceMetadata: DataSource, queryInput: QueryDataSourceInput) {
  const path = dataSourceMetadata.path;

  const s3Client = new S3Client({ region: "us-east-1" });

  const getObjectCMD = new GetObjectCommand({
    Bucket: STAGING_BUCKET,
    Key: path
  });

  const result = await s3Client.send(getObjectCMD);

  if (!result.Body) {
    return CreateBackendErrorResponse(500, "Failed to retrieve file from S3");
  }

  const csv = pd.readCSV(await result.Body.transformToString()) as any;

  const records = csv.toRecords();

  return CreateBackendResponse(200, {
    total: records.length,
    result: records.slice(0, queryInput.limit ?? 10)
  });
}

async function handleSQL(dataSourceMetadata: DataSource, secrets: SecretsManagerClient, queryInput: QueryDataSourceInput) {
  if (!queryInput.query) {
    return CreateBackendErrorResponse(400, "missing query");
  }

  const url = dataSourceMetadata.path;

  const connectionInfo = dataSourceMetadata.connectionInfo as string;

  const secretsParams = {
    SecretId: connectionInfo
  };

  const secretCommand = new GetSecretValueCommand(secretsParams);

  const response = await secrets.send(secretCommand);

  if (!response.SecretString) {
    return CreateBackendErrorResponse(500, `Failed to retrieve connection info for ${dataSourceMetadata.dataSourceID}`);
  }

  const decryptedConnectionInfo = JSON.parse(response.SecretString);

  switch (decryptedConnectionInfo.type) {
    case SQLType.MSSQL: {
      return await handleMSSQL(decryptedConnectionInfo, url, queryInput.query, queryInput.limit);
    }
    case SQLType.MYSQL: {
      // TODO: Implement these
      break;
    }
    case SQLType.POSTGRES: {
      // TODO: Implement these
      break;
    }
  }
}

async function handleMSSQL(decryptedConnectionInfo: any, url: string, query: string, limit?: number) {
  const configParams = {
    user: decryptedConnectionInfo.username,
    password: decryptedConnectionInfo.password,
    database: decryptedConnectionInfo.database,
    server: url,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    },
    options: {
      trustServerCertificate: true // change to true for local dev / self-signed certs
    }
  };

  const pool = await sql.connect(configParams);

  try {
    const result = await pool.request().query(query);

    await pool.close();

    return CreateBackendResponse(200, {
      total: result.recordset.length,
      result: limit !== undefined ? result.recordset.slice(0, limit) : result.recordset
    });
  } catch (err) {
    if (err instanceof sql.RequestError) {
      return CreateBackendErrorResponse(400, err);
    }

    console.error(err);

    return CreateBackendErrorResponse(500, "Failed to query the datasource");
  }
}
