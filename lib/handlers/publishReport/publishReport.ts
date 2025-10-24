import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, aws_LogEvent, EventType, getUserDataFromEvent, IReport } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GlueClient, StartJobRunCommand } from "@aws-sdk/client-glue";

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

    const result = await db.get(getParams);

    const report = result.Item as IReport;

    const startJobCommand = new StartJobRunCommand({
      JobName: GLUE_JOB,
      Arguments: { "--report-id": report.reportID, "--user": username }
    });

    await client.send(startJobCommand);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `Report publish for report ${report.reportID} started`);

    return CreateBackendResponse(200, "report publish process started");
  } catch (err) {
    console.log(err);
    return CreateBackendErrorResponse(500, "Failed to publish report");
  }
};
