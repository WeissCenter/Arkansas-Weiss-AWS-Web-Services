import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, getAdaptSettings } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const settings = await getAdaptSettings(db, SETTINGS_TABLE, "current");

    return CreateBackendResponse(200, settings);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to retrieve settings for the application");
  }
};
