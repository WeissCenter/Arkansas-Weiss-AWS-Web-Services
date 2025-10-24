import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  createUpdateItemFromObject,
  EventType,
  getUserDataFromEvent,
  UserTimeOutCacheInput
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const USER_TABLE = process.env.USER_TABLE || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();

  try {
    if (!event.body) {
      return CreateBackendErrorResponse(400, "missing body");
    }
    const username = getUserDataFromEvent(event).username;

    const input = JSON.parse(event.body) as UserTimeOutCacheInput;

    const date = Date.now();

    const body = {
      cache: input.action === "CLEAR" ? null : { ...input, added: date, expiry: date + 20 * 60 * 60 * 1000 }
    };

    const userActivityUpdate = {
      TableName: USER_TABLE,
      Key: {
        username
      },
      ReturnValues: ReturnValue.ALL_NEW,
      ...createUpdateItemFromObject(body)
    };

    const userActivityUpdateResult = await db.update(userActivityUpdate);

    if (input.action !== "CLEAR") {
      await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.USER, `User was logged out due to inactivity and data was saved`);
    }

    return CreateBackendResponse(200, userActivityUpdateResult.Attributes);
  } catch (err) {
    return CreateBackendErrorResponse(500, "failed to user timeout cache");
  }
};
