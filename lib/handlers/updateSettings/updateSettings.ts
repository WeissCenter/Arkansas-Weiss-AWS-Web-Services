import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, createUpdateItemFromObject, UpdateAdaptSettingsInput } from "../../../libs/types/src";
import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event.body) {
      return CreateBackendErrorResponse(400, "mising body");
    }
    const input = JSON.parse(event.body) as UpdateAdaptSettingsInput;

    const settingsUpdateItem = {
      TableName: SETTINGS_TABLE,
      Key: {
        type: "Settings",
        id: `ID#current`
      },
      ReturnValues: ReturnValue.ALL_NEW,
      ...createUpdateItemFromObject(input)
    };

    const settings = await db.update(settingsUpdateItem);

    return CreateBackendResponse(200, settings.Attributes);
  } catch (err) {
    return CreateBackendErrorResponse(500, "failed to update settings for the application");
  }
};
