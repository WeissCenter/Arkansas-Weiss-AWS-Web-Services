import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  DataSetQueueStatus,
  EventType,
  getDataView,
  getUserDataFromEvent,
  updateDataViewQueueStatus
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GlueClient, StartJobRunCommand } from "@aws-sdk/client-glue";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const GLUE_JOB = process.env.GLUE_JOB || "";

// AWS SDK Clients
const dynamodbClient = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(dynamodbClient);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
const glueClient = new GlueClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const dataViewID = event.pathParameters ? event.pathParameters["dataViewID"] : null;

  const username = getUserDataFromEvent(event).username;
  try {
    if (!dataViewID) {
      throw new Error("dataViewID is required");
    }
    const result = await getDataView(db, TABLE_NAME, dataViewID);

    if (!result) {
      return CreateBackendErrorResponse(404, "data set does not exist");
    }

    await updateDataViewQueueStatus(db, TABLE_NAME, dataViewID, DataSetQueueStatus.REQUESTED);

    const startJobCommand = new StartJobRunCommand({
      JobName: GLUE_JOB,
      Arguments: { "--data-view-id": dataViewID, "--user": username }
    });

    await glueClient.send(startJobCommand);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `Data Pull for ${dataViewID} started`);

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `Failed to start data pull for ${dataViewID}: ${JSON.stringify(err)}`);

    return CreateBackendErrorResponse(500, "failed to pull data");
  }
};
