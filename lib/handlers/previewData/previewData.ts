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
      // add the reporting year in because it is no longer a part of the data view fields by default
      const dataViewFields: DataViewField[] = [
        ...dataView.data.fields,
        {
          id: "reportingYear",
          label: "Reporting Year",
          value: dataView.reportingYear
        }
      ];
      console.log('Query before buildQuery:', file.database.query);
      const query = buildQuery(file.database.query, dataViewFields, file.columns);
      console.log('SQL Query:', query);
      switch (decryptedConnectionInfo.type) {
        case SQLType.MSSQL: {
          return {
            file: file.id,
            records: await handleMSSQL(pool, query, 10)
          };
        }
        case SQLType.MYSQL: {
          // TODO: Implement these
          console.error('MySQL handling not implemented yet');
          break;
        }
        case SQLType.POSTGRES: {
          // TODO: Implement these
          console.error('Postgres handling not implemented yet');
          break;
        }
      }
    })
  );

  await pool.close();

  return CreateBackendResponse(200, allRecords);
}

function buildQuery(base: string, dataViewFields: DataViewField[], columns?: string[]) {
  const vars = dataViewFields.reduce((accum, field) => Object.assign(accum, { [field.id]: field.value }), {} as Record<string, any>);

  // `${columns}` must expand to the file's column list as raw SQL (a comma-separated
  // identifier list in the SELECT clause), not a bound parameter. Column names come from
  // the trusted data collection template, so embedding them raw is safe.
  if (columns?.length) {
    vars.columns = SQL.raw(columns.join(", "));
  }

  // Split the template on ${name} placeholders. With the capture group, split() yields
  // alternating literal SQL (even indices) and variable names (odd indices). Literal text
  // is embedded raw; each placeholder's value is interpolated via the `sql` tag, so
  // primitives bind as parameters while raw fragments (e.g. columns) embed inline.
  const fragments = base.split(/\$\{(\w+)\}/).map((part, index) => {
    if (index % 2 === 0) {
      return SQL.raw(part);
    }
    if (!(part in vars)) {
      throw new Error(`Query references \${${part}} but no matching field was provided`);
    }
    return SQL`${vars[part]}`;
  });

  return SQL.join(fragments, SQL.raw("")).compile(queryBuilder) as CompiledQuery;
}

async function handleMSSQL(pool: sql.ConnectionPool, query: CompiledQuery, limit?: number) {
  const request = pool.request();

  for (const [index, param] of query.parameters.entries()) {
    request.input(`${index + 1}`, sql.VarChar, param);
  }

  // Apply the limit in SQL via TOP rather than slicing the recordset in memory.
  // Wrapping the original query as a subselect keeps it generic regardless of the
  // template's own clauses, and binds the limit as a parameter.
  let sqlText = query.sql;
  if (limit !== undefined) {
    request.input("limit", sql.Int, limit);
    sqlText = `SELECT TOP (@limit) * FROM (${query.sql}) AS limited_query`;
  }

  const result = await request.query(sqlText);

  // await pool.close();

  return result.recordset;
}
