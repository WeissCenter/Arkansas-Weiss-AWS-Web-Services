import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, DataSource, DataSourceConnectionInfo, EventType, getUserDataFromEvent } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import { GlueClient, UpdateConnectionCommand } from "@aws-sdk/client-glue";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { SecretsManagerClient, UpdateSecretCommand } from "@aws-sdk/client-secrets-manager";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const DATA_CATALOG = process.env.DATA_CATALOG || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const secrets = new SecretsManagerClient({ region: "us-east-1" });
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
const glue = new GlueClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const dataSourceID = event.pathParameters ? event.pathParameters["dataSourceId"] : null;
  const username = getUserDataFromEvent(event).username;
  try {
    if (!dataSourceID) {
      throw new Error("dataSourceID is required");
    }
    if (!event.body) {
      throw new Error("request body is required");
    }

    const body = JSON.parse(event.body) as DataSource;

    const connectionInfo = body.connectionInfo as DataSourceConnectionInfo;

    const secretID = `${dataSourceID}_SQLConnectionCredentials`;

    const newSecretCommand = new UpdateSecretCommand({
      SecretId: secretID,
      SecretString: JSON.stringify(connectionInfo)
    });

    await secrets.send(newSecretCommand);

    const params = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataSource",
        id: `ID#${dataSourceID}`
      },
      UpdateExpression: "SET #description = :description, #name = :name, #updated = :updated, #path = :path",
      ExpressionAttributeValues: {
        ":description": body.description,
        ":name": body.name,
        ":updated": Date.now(),
        ":path": body.path
      },
      ExpressionAttributeNames: {
        "#description": "description",
        "#name": "name",
        "#updated": "updated",
        "#path": "path"
      },
      ReturnValues: ReturnValue.ALL_NEW
    };

    const result = await db.update(params);

    const connectionName = `adapt-data-source-${dataSourceID}-connector`;

    const createConn = new UpdateConnectionCommand({
      CatalogId: DATA_CATALOG,
      Name: connectionName,
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

    await glue.send(createConn);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `DataSource: ${dataSourceID} was updated`);

    return CreateBackendResponse(200, result.Attributes);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to update data source");
  }
};
