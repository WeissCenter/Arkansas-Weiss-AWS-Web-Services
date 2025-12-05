import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse,
         aws_generateDailyLogStreamID, aws_LogEvent, createUpdateItemFromObject,
         updateDraftReportPublishStatus, EventType, getUserDataFromEvent, IReport } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommandOutput, ListObjectsCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { PublishStatus } from "../../../libs/types/src/lib/backend/PublishStatus";

// Define Environment Variables
const REPORT_TABLE = process.env.REPORT_TABLE || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const VIEWER_REPORT_CACHE = process.env.VIEWER_REPORT_CACHE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
const s3 = new S3Client({ region: "us-east-1" });

// unPublishReportHandler
export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const username = getUserDataFromEvent(event).username;

  try {
    const id = event.pathParameters ? event.pathParameters["reportId"] : null;
    if (!id) return CreateBackendErrorResponse(400, "missing reportID");

    if (!event?.body) return CreateBackendErrorResponse(400, "missing body");

    const body = JSON.parse(event?.body);

    if (!("justification" in body)) return CreateBackendErrorResponse(400, "missing justification");

    const getParams = {
      TableName: REPORT_TABLE,
      Key: {
        type: "Report",
        id: `ID#${id}#Version#finalized#Lang#en`
      }
    };

    const result = await db.get(getParams);

    if (!result?.Item) return CreateBackendErrorResponse(404, "Report does not exist or has not been published");

    const report = result.Item as IReport;

    // use this for development debugging
    /*
    const date = Date.now();

    const updateAuditReport = {
      TableName: REPORT_TABLE,
      Key: {
        type: "Report",
        id: `ID#${report.reportID}#Version#finalized-${date}`
      },
      ...createUpdateItemFromObject({ ...report, version: date }, ["id", "type"])
    };

    await db.update(updateAuditReport);

     */

    // clear s3 express caches

    const deleteOldFinalized = {
      TableName: REPORT_TABLE,
      Key: {
        type: "Report",
        id: `ID#${report.reportID}#Version#finalized#Lang#en`
      }
    };

    // 1) Now we need to update the publish status on the draft entry in dynamo db to set it back to unpublished
    // 2) Delete the one and only finalized version and create a copy of it with a time stamp and
    // 3) then delete the published report from S3
    //await Promise.all([db.update(updateAuditReport), db.delete(deleteOldFinalized), deleteFolder(s3, report.slug!, VIEWER_REPORT_CACHE)]);
    await Promise.all([updateDraftReportPublishStatus(REPORT_TABLE, report.reportID, PublishStatus.UNPUBLISHED, username, db),
                       db.delete(deleteOldFinalized),
      deleteFolder(s3, report.slug!, VIEWER_REPORT_CACHE)]);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `Report ${report.reportID} was unpublished`);

    return CreateBackendResponse(200, "report publish process started");
  } catch (err) {
    console.log(err);
    return CreateBackendErrorResponse(500, "Failed to publish report");
  }
};

async function deleteFolder(client: S3Client, key: string, bucketName: string): Promise<void> {
  const DeletePromises: Promise<DeleteObjectCommandOutput>[] = [];
  const { Contents } = await client.send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: key + "/" }));

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
