import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, AddDataInput, aws_generateDailyLogStreamID, aws_LogEvent, DataSourceType, EventType, getUserDataFromEvent, SQLType } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, CreateSecretCommand, DeleteSecretCommand } from "@aws-sdk/client-secrets-manager";
import { GlueClient, CreateConnectionCommand, CreateCrawlerCommand, DeleteCrawlerCommand, DeleteConnectionCommand, CreateConnectionCommandOutput, CreateCrawlerCommandOutput } from "@aws-sdk/client-glue";

import { randomUUID } from "crypto";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const DATA_CATALOG = process.env.DATA_CATALOG || "";
const DATA_CATALOG_NAME = process.env.DATA_CATALOG_NAME || "";
const CRAWLER_ROLE = process.env.CRAWLER_ROLE || "";
// Glue Data VPC placement (from AdaptNetworkStack) — stamped onto the connection so
// the data pull runs in-VPC and routes to the client DB over the Site-to-Site VPN.
const GLUE_SUBNET_ID = process.env.GLUE_SUBNET_ID || "";
const GLUE_SG_ID = process.env.GLUE_SG_ID || "";
const GLUE_AZ = process.env.GLUE_AZ || "";

/**
 * JDBC URL for the connection's engine (all current clients are MS SQL Server,
 * canonical `;databaseName=` form). NOTE: Glue's URL validator rejects trailing
 * driver params (`;encrypt=...`), so TLS options must go in ConnectionProperties
 * (JDBC_ENFORCE_SSL), never the URL. The VPN already encrypts the wire.
 */
function buildJdbcUrl(type: SQLType, host: string, port: number, database: string): string {
  switch (type) {
    case SQLType.POSTGRES:
      return `jdbc:postgresql://${host}:${port}/${database}`;
    case SQLType.MYSQL:
      return `jdbc:mysql://${host}:${port}/${database}`;
    case SQLType.MSSQL:
    default:
      return `jdbc:sqlserver://${host}:${port};databaseName=${database}`;
  }
}

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const secrets = new SecretsManagerClient({ region: "us-east-1" });
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
const glue = new GlueClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const username = getUserDataFromEvent(event).fullName;
  const dataSourceID = randomUUID();
  // Declared up front so the rollback in catch can clean the secret up too.
  const secretID = `${dataSourceID}_SQLConnectionCredentials`;

  let crawler;
  let connectionName;
  let secretCreated = false;
  let crawlerResult: CreateCrawlerCommandOutput = {} as CreateCrawlerCommandOutput;
  let connectionResult: CreateConnectionCommandOutput = {} as CreateConnectionCommandOutput;

  try {
    if (!event.body) {
      return CreateBackendResponse(400, "Missing body");
    }
    const body = JSON.parse(event.body) as AddDataInput;

    if (!body?.connectionInfo) {
      return CreateBackendResponse(400, "Missing connection information");
    }

    const connectionInfo = body.connectionInfo;

    const newSecretCommand = new CreateSecretCommand({
      Name: secretID,
      SecretString: JSON.stringify(connectionInfo)
    });

    await secrets.send(newSecretCommand);
    secretCreated = true;

    const newDBItem = {
      type: "DataSource",
      dataSourceID: dataSourceID,
      id: `ID#${dataSourceID}`,
      description: body.description,
      name: body.name,
      created: Date.now(),
      updated: Date.now(),
      author: username,
      path: body.path,
      connectionInfo: secretID
    };

    const params = {
      TableName: TABLE_NAME,
      Item: newDBItem
    };

    await db.put(params);

    connectionName = `adapt-data-source-${dataSourceID}-connector`;

    // VPC placement only when the Glue Data VPC is provisioned (ENABLE_CLIENT_DB_VPN);
    // otherwise the connection reaches publicly-routable DBs only (original behavior).
    const usePhysicalConnection = Boolean(GLUE_SUBNET_ID && GLUE_SG_ID && GLUE_AZ);

    const createConn = new CreateConnectionCommand({
      CatalogId: DATA_CATALOG,
      ConnectionInput: {
        Name: connectionName,
        ConnectionType: "JDBC",
        ConnectionProperties: {
          // Reference the secret instead of inlining credentials — Glue resolves
          // the username/password from it at connect time.
          SECRET_ID: secretID,
          JDBC_CONNECTION_URL: buildJdbcUrl(connectionInfo.type, body.path, connectionInfo.port, connectionInfo.database)
        } as any,
        // Run the connection (and any job/crawler that uses it) inside the Glue
        // Data VPC so traffic routes to the client DB over the Site-to-Site VPN.
        ...(usePhysicalConnection
          ? {
              PhysicalConnectionRequirements: {
                SubnetId: GLUE_SUBNET_ID,
                SecurityGroupIdList: [GLUE_SG_ID],
                AvailabilityZone: GLUE_AZ
              }
            }
          : {})
      }
    });

    connectionResult = await glue.send(createConn);

    crawler = `adapt-data-source-${dataSourceID}-crawler`;

    const createCrawlerConn = new CreateCrawlerCommand({
      Name: crawler,
      DatabaseName: DATA_CATALOG_NAME,
      Role: CRAWLER_ROLE,
      Targets: {
        JdbcTargets: [
          {
            ConnectionName: connectionName,
            Path: "%"
          }
        ]
      }
    });

    crawlerResult = await glue.send(createCrawlerConn);

    const updateParams = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataSource",
        id: `ID#${dataSourceID}`
      },
      UpdateExpression: "SET #crawler = :crawler, #glueConnection = :glueConnection",
      ExpressionAttributeNames: {
        "#crawler": "crawler",
        "#glueConnection": "glueConnection"
      },
      ExpressionAttributeValues: {
        ":crawler": crawler,
        ":glueConnection": connectionName
      }
    };

    await db.update(updateParams);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `DataSource: ${dataSourceID} of type ${DataSourceType.SQL} was successfully created`);

    return CreateBackendResponse(200, newDBItem);
  } catch (err) {
    console.error(err);

    // cleanup

    const deleteItemParams = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataSource",
        id: `ID#${dataSourceID}`
      }
    };

    await db.delete(deleteItemParams);

    if (crawler && crawlerResult?.$metadata?.httpStatusCode === 200) {
      const deleteCrawlerCommand = new DeleteCrawlerCommand({
        Name: crawler
      });

      await glue.send(deleteCrawlerCommand);
    }

    if (connectionName && connectionResult?.$metadata?.httpStatusCode === 200) {
      const deleteConnection = new DeleteConnectionCommand({
        ConnectionName: connectionName
      });

      await glue.send(deleteConnection);
    }

    // Remove the secret so failed creations don't leak orphaned secrets.
    if (secretCreated) {
      try {
        await secrets.send(new DeleteSecretCommand({ SecretId: secretID, ForceDeleteWithoutRecovery: true }));
      } catch (cleanupErr) {
        console.error("Failed to delete secret during rollback", cleanupErr);
      }
    }

    return CreateBackendErrorResponse(500, "Failed to add new data source");
  }
};
