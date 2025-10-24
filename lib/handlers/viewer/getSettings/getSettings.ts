import { APIGatewayEvent, Context, Handler } from "aws-lambda";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { getAdaptSettings, CreateBackendResponse, CreateBackendErrorResponse, deleteIfPresent } from "../../../../libs/types/src";

// Define Environment Variables
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  try {
    const settings = await getAdaptSettings(db, SETTINGS_TABLE, "current");

    // logo: string;
    // copyright: string;
    // idleMinutes: number;
    // nSize: number;
    // warningMinutes: number;
    // timeoutMinutes: number;
    // footerLinks?: FooterLinks[];
    // supportedLanguages?: LanguageCode[]

    // remove admin only settings
    deleteIfPresent(settings, "idleMinutes");
    deleteIfPresent(settings, "nSize");
    deleteIfPresent(settings, "warningMinutes");
    deleteIfPresent(settings, "timeoutMinutes");

    return CreateBackendResponse(200, settings);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to retrieve settings for the application");
  }
};
