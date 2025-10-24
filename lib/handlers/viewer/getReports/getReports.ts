import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, cleanDBFields, IReport, ReportVersion, getReportBySlug, ITemplatePage } from "../../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument, QueryCommandInput } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const REPORT_TABLE = process.env.REPORT_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  try {
    const lang = event.queryStringParameters?.["lang"] || "en";

    if (event.pathParameters && event.pathParameters["slug"]) {
      const report = await getReportBySlug(
        db,
        event.pathParameters["slug"],
        REPORT_TABLE,
        "#name, published, slug, template.title, template.metaTags, template.filters, template.description, template.pages",
        { "#name": "name" },
        lang
      );

      if (!report) return CreateBackendErrorResponse(404, "report does not exist");

      report.template.pages = (report.template.pages as any)?.map((page) => ({
        id: page.id
      }));

      return CreateBackendResponse(200, report);
    }

    const reports = await getReports(lang);

    return CreateBackendResponse(200, reports);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to retrieve reports");
  }
};

async function getReports(lang = "en") {
  const scanParams: QueryCommandInput = {
    TableName: REPORT_TABLE,
    KeyConditionExpression: "#type = :type",
    FilterExpression: "#version = :finalized AND #lang = :lang",
    ExpressionAttributeValues: {
      ":type": "Report",
      ":finalized": "finalized",
      ":lang": lang
    },
    ExpressionAttributeNames: {
      "#type": "type",
      "#version": "version",
      "#name": "name",
      "#lang": "lang"
    },
    ProjectionExpression: "#name, published, slug, template.title, template.metaTags, template.description"
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
    .map((source) => cleanDBFields(source))
    .map((source) => {
      return source;
    });
}
