import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, EventType, getUserDataFromEvent } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { DeleteObjectCommand, DeleteObjectCommandOutput, ListObjectsCommand, S3Client } from "@aws-sdk/client-s3";

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
    await Promise.all([deleteFolder(s3, dataViewID, STAGING_BUCKET), deleteFolder(s3, dataViewID, REPO_BUCKET)]);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `DataView: ${dataViewID} was deleted`);

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);
    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `DataView: ${dataViewID} failed to delete: ${JSON.stringify(err)}`);

    return CreateBackendErrorResponse(500, "failed to delete data source");
  }
};

async function deleteFolder(client: S3Client, key: string, bucketName: string): Promise<void> {
  const DeletePromises: Promise<DeleteObjectCommandOutput>[] = [];
  const { Contents } = await client.send(new ListObjectsCommand({ Bucket: bucketName, Prefix: key }));

  if (!Contents) return;

  for (const object of Contents) {
    DeletePromises.push(
      client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: object.Key
        })
      )
    );
  }

  await Promise.all(DeletePromises);
}
