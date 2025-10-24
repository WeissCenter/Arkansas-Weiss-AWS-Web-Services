import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, IsUniqueInput } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const REPORT_TABLE_NAME = process.env.REPORT_TABLE_NAME || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "missing body");
    }

    const body = JSON.parse(event.body) as IsUniqueInput;

    const field = body.field ?? "name";

    const params = {
      TableName: body.type === "Report" ? REPORT_TABLE_NAME : TABLE_NAME,
      KeyConditionExpression: "#type = :type",
      FilterExpression: "#field = :value",
      ExpressionAttributeNames: {
        "#type": "type",
        "#field": field
      },
      ExpressionAttributeValues: {
        ":type": body.type,
        ":value": body.name
      }
    };

    const result = await db.query(params);

    return CreateBackendResponse(200, result.Items === undefined || result.Items.length <= 0);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to check name unique");
  }
};
