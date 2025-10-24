import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, DataView, DataViewField, getDatasourceMetadata, getDataView, SQLType } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { Kysely, DummyDriver, MssqlAdapter, MssqlIntrospector, MssqlQueryCompiler, sql as SQL, CompiledQuery } from "kysely";
import * as sql from "mssql";
import * as xlsx from "xlsx";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const STAGING_BUCKET = process.env.STAGING_BUCKET || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const secrets = new SecretsManagerClient({ region: "us-east-1" });
const s3Client = new S3Client({ region: "us-east-1" });

const queryBuilder = new Kysely<any>({
  dialect: {
    createAdapter: () => new MssqlAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new MssqlIntrospector(db),
    createQueryCompiler: () => new MssqlQueryCompiler()
  }
});

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const dataViewID = event.pathParameters ? event.pathParameters["dataViewID"] : null;
    if (!dataViewID) {
      return CreateBackendErrorResponse(400, "dataViewID is required");
    }

    const dataView = await getDataView(db as any, TABLE_NAME, dataViewID);

    if (!dataView) {
      return CreateBackendErrorResponse(404, `Data View with ID ${dataViewID} does not exist`);
    }

    switch (dataView.dataViewType) {
      case "collection": {
        return await handleFile(dataView);
      }
      case "database": {
        return await handleSQL(dataView, secrets, db);
      }
    }

    return CreateBackendErrorResponse(400, "unknown data view type");
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to query data source");
  }
};

async function handleFile(dataView: DataView) {
  const allRecords = await Promise.all(
    dataView.data.files
      .filter((file) => file.location.length > 0)
      .map(async (file) => {
        const getObjectCMD = new GetObjectCommand({
          Bucket: STAGING_BUCKET,
          Key: `${dataView.dataViewID}/${file.id}/${file.location}`
        });

        const result = await s3Client.send(getObjectCMD);

        // TODO: determine if this error handling is correct
        if (!result.Body) {
          throw new Error("Failed to retrieve file data from S3");
        }

        const fileData = await result.Body.transformToString();

        const csv = xlsx.read(fileData, { type: "string", sheetRows: 11 });

        return {
          file: file.id,
          records: xlsx.utils.sheet_to_json(csv.Sheets[csv.SheetNames[0]], {
            blankrows: true,
            raw: true,
            defval: ""
          })
        };
      })
  );

  return CreateBackendResponse(200, allRecords);
}

async function handleSQL(dataView: DataView, secrets: SecretsManagerClient, db: DynamoDBClient) {
  const dataSource = dataView.data.dataSource;

  // TODO: determine if this error handling is correct
  if (!dataSource) {
    return CreateBackendErrorResponse(400, "Data source is required");
  }

  const dataSourceMetadata = await getDatasourceMetadata(db, TABLE_NAME, dataSource);

  // TODO: determine if this error handling is correct
  if (!dataSourceMetadata) {
    return CreateBackendErrorResponse(404, `Data Source with ID ${dataSource} does not exist`);
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

  const allRecords = await Promise.all(
    dataView.data.files.map(async (file) => {
      // TODO: determine if this error handling is correct
      if (!file.database) {
        throw new Error(`Database information is missing for file ${file.id}`);
      }
      const query = buildQuery(file.database.query, dataView.data.fields);

      switch (decryptedConnectionInfo.type) {
        case SQLType.MSSQL: {
          return {
            file: file.id,
            records: await handleMSSQL(pool, query, 10)
          };
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
    })
  );

  await pool.close();

  return CreateBackendResponse(200, allRecords);
}

function buildQuery(base: string, dataViewFields: DataViewField[]) {
  const vars = dataViewFields.reduce((accum, field) => Object.assign(accum, { [field.id]: field.value }), {});

  const query = dynamicSQLTemplate(base, { sql: SQL, ...vars });

  return query.compile(queryBuilder) as CompiledQuery;
}

function dynamicSQLTemplate(template: string, vars = {}) {
  const handler = new Function("vars", ["const tagged = ( " + Object.keys(vars).join(", ") + " ) =>", "sql`" + template + "`", "return tagged(...Object.values(vars))"].join("\n"));

  return handler(vars);
}

async function handleMSSQL(pool: sql.ConnectionPool, query: CompiledQuery, limit?: number) {
  const request = pool.request();

  for (const [index, param] of query.parameters.entries()) {
    request.input(`${index + 1}`, sql.VarChar, param);
  }

  const result = await request.query(query.sql);

  // await pool.close();

  return limit !== undefined ? result.recordset.slice(0, limit) : result.recordset;
}
