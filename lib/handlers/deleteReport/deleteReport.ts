import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, EventType, getUserDataFromEvent, getReportVersionsAndLangsFromDynamo, deleteFolder } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

// Define Environment Variables
const REPORT_TABLE = process.env.REPORT_TABLE || "";
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
  const reportId = event.pathParameters ? event.pathParameters["reportId"] : null;
  const username = getUserDataFromEvent(event).username;
  
  try {
    if (!reportId) {
      throw new Error("reportId is required");
    }
    // TODO: get all reports that begin with ID#${reportID} (to cover all languages and versions)
    const reportLangAndVersions = await getReportVersionsAndLangsFromDynamo(db, REPORT_TABLE, reportId);

    if (reportLangAndVersions.length === 0) {
      return CreateBackendErrorResponse(404, "Report not found");
    }

    const isReportDeletable = reportLangAndVersions.every((report) => (report.version.startsWith("draft") || report.version === "failed"));
    
    if (!isReportDeletable) {
      return CreateBackendErrorResponse(400, "Only reports in draft or failed status can be deleted");
    }

    const reportKeysToDelete = reportLangAndVersions.map((report) => ({ type: report.type, id: report.id }));
    
    await deleteReport(reportId, reportKeysToDelete);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `Report: ${reportId} was deleted`);

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);
    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.DELETE, `Report: ${reportId} failed to delete: ${JSON.stringify(err)}`);

    return CreateBackendErrorResponse(500, "failed to delete report");
  }
};

async function deleteReport(reportID: string, reportKeysToDelete?: { type: string, id: string }[]) {
  // delete report from DynamoDB
  if (reportKeysToDelete && reportKeysToDelete.length > 0) {
    const deletePromises = reportKeysToDelete.map((key) => db.delete({
      TableName: REPORT_TABLE,
      Key: key,
      ReturnValues: "ALL_OLD"
    }));
    const settledDynamoDeletions = await Promise.allSettled(deletePromises);
    const failedDynamoDeletions = settledDynamoDeletions.filter((result) => result.status === "rejected");
    const successfulDynamoDeletions = settledDynamoDeletions.filter(
      (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled"
    );
  

    if (failedDynamoDeletions.length > 0 && successfulDynamoDeletions.length > 0) {
      // if some deletions succeeded and some failed, we should log this as an error and potentially attempt to roll back the successful deletions to maintain data integrity
      console.error(`Partial failure when deleting report entries from DynamoDB for reportID: ${reportID}. Some entries were deleted successfully while others failed. Manual review may be required to ensure data integrity.`, {
        failedDeletions: failedDynamoDeletions,
        successfulDeletions: successfulDynamoDeletions
      });
      const rollbackPromises = successfulDynamoDeletions.map((result) => {
        const deletedItem = result.value.Attributes;
        if (deletedItem) {
          return db.put({
            TableName: REPORT_TABLE,
            Item: deletedItem
          });
        }
      });
      const rollbackResults = await Promise.allSettled(rollbackPromises);
      const failedRollbacks = rollbackResults.filter((result) => result.status === "rejected");
      if (failedRollbacks.length > 0) {
        console.error(`Failed to roll back some successful deletions for reportID: ${reportID}`, failedRollbacks);
        throw new Error(`Partial failure when deleting report entries from DynamoDB for reportID: ${reportID}. Additionally, failed to roll back some of the successful deletions. Manual intervention is likely required to resolve this issue and ensure data integrity.`);
      } else {
        console.log(`Successfully rolled back all successful deletions for reportID: ${reportID}`);
      }
    } else if (failedDynamoDeletions.length > 0 && successfulDynamoDeletions.length === 0) {
      // if all deletions failed, we can throw an error to be caught by the outer try-catch and return a 500 response
      throw new Error(`Failed to delete any report entries from DynamoDB for reportID: ${reportID}. No entries were deleted.`);
    }

  }

  // clear out s3 files from staging and repo buckets
  const [stagingResult, repoResult] = await Promise.all([
    deleteFolder(s3, reportID, STAGING_BUCKET),
    deleteFolder(s3, reportID, REPO_BUCKET)
  ]);

  if (stagingResult && stagingResult.some(result => result.status === "rejected")) {
    console.error(`Failed to delete report files from staging bucket for reportID: ${reportID}`, stagingResult.filter(result => result.status === "rejected"));
  }
  if (repoResult && repoResult.some(result => result.status === "rejected")) {
    console.error(`Failed to delete report files from repo bucket for reportID: ${reportID}`, repoResult.filter(result => result.status === "rejected"));
  }
}

