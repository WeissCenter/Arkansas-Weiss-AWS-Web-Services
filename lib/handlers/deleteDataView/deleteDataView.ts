import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, EventType, getUserDataFromEvent, deleteFolder } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const STAGING_BUCKET = process.env.STAGING_BUCKET || "";
const REPO_BUCKET = process.env.REPO_BUCKET || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const s3 = new S3Client({ region: "us-east-1" });
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const dataViewID = event.pathParameters ? event.pathParameters["dataViewID"] : null;
  const username = getUserDataFromEvent(event).username;

  try {
    if (!dataViewID) {
      throw new Error("dataViewID is required");
    }

    const params = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataView",
        id: `ID#${dataViewID}`
      }
    };

    await db.delete(params);

    // clear out s3 files from staging and repo buckets
    const [stagingResult, repoResult] = await Promise.all([deleteFolder(s3, dataViewID, STAGING_BUCKET), deleteFolder(s3, dataViewID, REPO_BUCKET)]);

    if (stagingResult && stagingResult.some(result => result.status === "rejected")) {
      console.error(`Failed to delete data view files from staging bucket for dataViewID: ${dataViewID}`, stagingResult.filter(result => result.status === "rejected"));
    }
    if (repoResult && repoResult.some(result => result.status === "rejected")) {
      console.error(`Failed to delete data view files from repo bucket for dataViewID: ${dataViewID}`, repoResult.filter(result => result.status === "rejected"));
    }

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `DataView: ${dataViewID} was deleted`);

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);
    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `DataView: ${dataViewID} failed to delete: ${JSON.stringify(err)}`);

    return CreateBackendErrorResponse(500, "failed to delete data source");
  }
};
