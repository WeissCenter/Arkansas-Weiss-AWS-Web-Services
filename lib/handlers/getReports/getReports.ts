import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, cleanDBFields, IReport, ReportVersion } from "../../../libs/types/src";
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
    const reports = await getReports();

    return CreateBackendResponse(200, reports);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to retrieve reports");
  }
};

async function getReports() {
  const scanParams = {
    TableName: REPORT_TABLE,
    KeyConditionExpression: "#type = :type",
    FilterExpression: "#version IN (:draft, :finalized) AND #lang in (:default)",
    ExpressionAttributeValues: {
      ":type": "Report",
      ":draft": "draft",
      ":finalized": "finalized",
      ":default": "en"
    },
    ExpressionAttributeNames: {
      "#type": "type",
      "#version": "version",
      "#lang": "lang"
    }
  };

  let result, lastKey;
  let accumulated: IReport[] = [];

  do {
    result = await db.query({ ...scanParams, ExclusiveStartKey: lastKey });

    lastKey = result.LastEvaluatedKey;

    accumulated = [...accumulated, ...(result.Items || [])];
  } while (lastKey);

  // filter such that only the highest versions is returned?

  return accumulated
    .filter(
      (report) =>
        report.version === ReportVersion.FINALIZED ||
        (report.version === ReportVersion.DRAFT && accumulated.findIndex((rpt) => rpt.reportID === report.reportID && rpt.version === ReportVersion.FINALIZED) === -1)
    )
    .map((source) => cleanDBFields(source))
    .map((source) => {
      source.template = {
        id: source.template.id,
        description: source.template.description,
        title: source.template.title
      };
      return source;
    });
}
