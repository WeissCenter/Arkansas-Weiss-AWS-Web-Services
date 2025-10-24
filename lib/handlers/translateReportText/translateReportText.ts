import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  TestDBConnectionInput,
  getAdaptSettings,
  getReportFromDynamo,
  ReportVersion,
  LanguageCode,
  aws_LogEvent,
  aws_generateDailyLogStreamID,
  getUserDataFromEvent,
  EventType
} from "../../../libs/types/src";
import * as sql from "mssql";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { translateJSON } from "../../../scripts/translate";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

// Define Environment Variables

const REPORT_TABLE = process.env.REPORT_TABLE || "";
const SETTINGS_TABLE = process.env.SETTINGS_TABLE || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  try {
    const report = event.pathParameters?.["reportId"];
    const logStream = aws_generateDailyLogStreamID();
    const username = getUserDataFromEvent(event).username;
    const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

    if (!report) {
      return CreateBackendErrorResponse(400, "missing report id");
    }

    const lang = event.queryStringParameters?.["lang"];

    if (!event.body) {
      return CreateBackendErrorResponse(400, "missing body");
    }

    const translatableFields = JSON.parse(event.body) as {
      title: string;
      description: string;
    };

    if (!translatableFields["title"] || !translatableFields["description"]) {
      return CreateBackendErrorResponse(400, "missing required fields");
    }

    // get list of supported langs from the settings and return all translations

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `Generating translations for report ${report}`);

    if (!lang) {
      const settings = await getAdaptSettings(db, SETTINGS_TABLE, "current");

      const supportedLangs = settings?.supportedLanguages;

      if (!supportedLangs || !supportedLangs.length) {
        return CreateBackendResponse(200, { en: translatableFields });
      }

      const validLangs = supportedLangs.filter((lang) => lang !== "en");

      const resultList = await Promise.all(validLangs.map((lang) => translateJSON("en", lang, translatableFields)));

      const resultObject = validLangs.reduce((accum, val, index) => Object.assign(accum, { [val]: resultList[index] }), {});

      return CreateBackendResponse(200, resultObject);
    }

    // return the single
    const translated = await translateJSON("en", lang, translatableFields);

    return CreateBackendResponse(200, { lang: translated });
  } catch (err) {
    console.error(err);

    return CreateBackendErrorResponse(500, "Failed to translate report text");
  }
};
