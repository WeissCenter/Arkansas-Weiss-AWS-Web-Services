import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, EventType, getUserDataFromEvent } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

// Define Environment Variables
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const client = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const username = getUserDataFromEvent(event).username;
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "missing body");
    }

    const body = JSON.parse(event?.body);

    const userEvent = body.event;
    const extraMeta = body.metadata;

    const logStreamName = aws_generateDailyLogStreamID();

    await aws_LogEvent(client, LOG_GROUP, logStreamName, username, EventType.USER, userEvent, extraMeta);

    return CreateBackendResponse(200, "event recorded");
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to record event");
  }
};
