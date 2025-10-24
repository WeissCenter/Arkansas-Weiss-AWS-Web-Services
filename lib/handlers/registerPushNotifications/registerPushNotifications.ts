import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, RegisterPushNotificationsInput } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event.body) {
      return CreateBackendErrorResponse(404, "Missing body");
    }

    const body = JSON.parse(event.body) as RegisterPushNotificationsInput;

    const params = {
      TableName: TABLE_NAME,
      Item: {
        id: body.id,
        subscription: body.subscription
      }
    };

    await db.put(params);

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to register notification");
  }
};
