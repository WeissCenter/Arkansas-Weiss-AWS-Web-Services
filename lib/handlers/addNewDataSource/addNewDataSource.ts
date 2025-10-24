import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, AddDataInput, aws_generateDailyLogStreamID, aws_LogEvent, DataSourceType, EventType, getUserDataFromEvent } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, CreateSecretCommand } from "@aws-sdk/client-secrets-manager";
import { GlueClient, CreateConnectionCommand, CreateCrawlerCommand, DeleteCrawlerCommand, DeleteConnectionCommand, CreateConnectionCommandOutput, CreateCrawlerCommandOutput } from "@aws-sdk/client-glue";

import { randomUUID } from "crypto";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const DATA_CATALOG = process.env.DATA_CATALOG || "";
const DATA_CATALOG_NAME = process.env.DATA_CATALOG_NAME || "";
const CRAWLER_ROLE = process.env.CRAWLER_ROLE || "";

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

  let crawler;
  let connectionName;
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

    const secretID = `${dataSourceID}_SQLConnectionCredentials`;

    const newSecretCommand = new CreateSecretCommand({
      Name: secretID,
      SecretString: JSON.stringify(connectionInfo)
    });

    await secrets.send(newSecretCommand);

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

    const createConn = new CreateConnectionCommand({
      CatalogId: DATA_CATALOG,
      ConnectionInput: {
        Name: connectionName,
        ConnectionType: "JDBC",
        ConnectionProperties: {
          USERNAME: connectionInfo.username,
          PASSWORD: connectionInfo.password,
          JDBC_CONNECTION_URL: `jdbc:sqlserver://${body.path}:${connectionInfo.port}/${connectionInfo.database}`
        } as any
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

    return CreateBackendErrorResponse(500, "Failed to add new data source");
  }
};
