import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, getReportFromDynamo, ReportVersion, getReportVersionsFromDynamo, IReport } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const REPORT_TABLE = process.env.REPORT_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const id = event.pathParameters?.["reportId"];
    if (!id) {
      return CreateBackendErrorResponse(400, "reportId is required");
    }
    const version = (event?.queryStringParameters?.["version"] ?? "draft") as ReportVersion;

    const lang = event?.queryStringParameters?.["lang"];

    if (!lang || !lang.length) {
      const reports = (await getReportVersionsFromDynamo(db, REPORT_TABLE, id)) as IReport[];

      const draftReports = reports.filter((rpt) => rpt.version === version);

      return CreateBackendResponse(200, draftReports);
    }

    const report = await getReportFromDynamo(db, REPORT_TABLE, id, version, lang);

    return CreateBackendResponse(200, report);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to retrieve reports");
  }
};
