import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, EventType, getUserDataFromEvent } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const username = getUserDataFromEvent(event).username;
  const dataSourceID = event.pathParameters ? event.pathParameters["dataSourceId"] : null;

  try {
    if (!dataSourceID) {
      throw new Error("dataSourceID is required");
    }

    const params = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataSource",
        id: `ID#${dataSourceID}`
      }
    };

    await db.delete(params);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `DataSource: ${dataSourceID} was deleted`);

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `DataSource: ${dataSourceID} failed to delete: ${JSON.stringify(err)}`);

    return CreateBackendErrorResponse(500, "failed to delete data source");
  }
};
