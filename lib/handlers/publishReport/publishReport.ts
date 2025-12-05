import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  EventType,
  getUserDataFromEvent,
  IReport,
  createUpdateItemFromObject
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GlueClient, StartJobRunCommand } from "@aws-sdk/client-glue";
import { PublishStatus } from "../../../libs/types/src/lib/backend/PublishStatus";

// Define Environment Variables
const REPORT_TABLE = process.env.REPORT_TABLE || "";
const GLUE_JOB = process.env.GLUE_JOB || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const dynamoClient = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(dynamoClient);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
const client = new GlueClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const username = getUserDataFromEvent(event).username;

  try {
    const id = event.pathParameters ? event.pathParameters["reportId"] : null;
    if (!id) {
      throw new Error("reportId is missing in path parameters");
    }

    const getParams = {
      TableName: REPORT_TABLE,
      Key: {
        type: "Report",
        id: `ID#${id}#Version#draft#Lang#en`
      }
    };

    const tableRow = await db.get(getParams);

    const originalDraftReport = tableRow.Item as IReport;

    const startJobCommand = new StartJobRunCommand({
      JobName: GLUE_JOB,
      Arguments: { "--report-id": originalDraftReport.reportID, "--user": username }
    });

    await client.send(startJobCommand);

    // this logs directly in the lambda function's cloudwatch log
    console.log( `Started publishing report ${originalDraftReport.reportID}`);

    // ####### Now we need to update the publish status on the draft entry in dynamo db ####
    const updatePublishStatusForReport = {
      TableName: REPORT_TABLE,
      Key: {
        type: "Report",
        id: `ID#${id}#Version#draft#Lang#en`
      },
      ...createUpdateItemFromObject({ status: PublishStatus.PROCESSING })
    };

    await db.update(updatePublishStatusForReport);

    console.log(`Updated publish status to: PROCESSING for report ${originalDraftReport.reportID}`);

    //#########################################################################################################

    return CreateBackendResponse(200, "report publish process started");
  } catch (err) {
    console.log(err);
    return CreateBackendErrorResponse(500, "Failed to publish report");
  }
};
