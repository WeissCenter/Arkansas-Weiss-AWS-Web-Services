import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, CreateReportInput, getUserDataFromEvent } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// Define Environment Variables
const REPORT_TABLE = process.env.REPORT_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const fullName = getUserDataFromEvent(event).fullName;

  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const body = JSON.parse(event.body) as CreateReportInput;

    const newReportID = randomUUID();

    const newReportItem = {
      type: "Report",
      id: `ID#${newReportID}#Version#draft#Lang#en`,
      reportID: newReportID,
      updated: `${Date.now()}`,
      version: "draft",
      template: body.template,
      dataView: body.dataView,
      author: fullName,
      slug: body.slug,
      visibility: body.visibility,
      name: body.name,
      lang: "en",
      reportingLevel: body.reportingLevel
    };

    const putParams = {
      TableName: REPORT_TABLE,
      Item: newReportItem
    };

    await db.put(putParams);
    return CreateBackendResponse(200, newReportID);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to create report");
  }
};
