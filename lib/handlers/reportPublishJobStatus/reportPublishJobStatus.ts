// @ts-nocheck // FIXME: come back and fix typescript errors

import { Context, EventBridgeEvent, Handler } from "aws-lambda";
import {
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  CreateBackendErrorResponse,
  EventType,
  getAdaptSettings,
  getReportFromDynamo,
  getSubscription,
  ITemplate,
  ReportVersion,
  updateReportVersion
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GetJobRunCommand, GlueClient } from "@aws-sdk/client-glue";
import * as webpush from "web-push";
import { InvokeCommand, LambdaClient, LogType } from "@aws-sdk/client-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { translateJSON } from "../../../scripts/translate";
import slugify from "slugify";

import crypto from "node:crypto";
// Define Environment Variables
const TABLE_NAME = process.env["TABLE_NAME"] || "";
const SETTINGS_TABLE_NAME = process.env["SETTINGS_TABLE_NAME"] || "";
const NOTIFICATION_TABLE_NAME = process.env["NOTIFICATION_TABLE_NAME"] || "";
const LOG_GROUP = process.env["LOG_GROUP"] || "";
const PUBLIC_VAPID_KEY = process.env["PUBLIC_VAPID_KEY"] || "";
const PRIVATE_VAPID_KEY = process.env["PRIVATE_VAPID_KEY"] || "";
const VIEWER_REPORT_CACHE = process.env["VIEWER_REPORT_CACHE"] || "";
const RENDER_TEMPLATE_FUNCTION = process.env["RENDER_TEMPLATE_FUNCTION"] || "";
// AWS SDK Clients
const glueClient = new GlueClient({ region: "us-east-1" });
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
const lambdaClient = new LambdaClient({ region: "us-east-1" });
const s3Client = new S3Client({ region: "us-east-1" });
webpush.setVapidDetails("https://weissta.org/", PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);

export const handler: Handler = async (event: EventBridgeEvent<string, any>, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();

  try {
    const detail = event.detail;

    const getRunCommand = new GetJobRunCommand({
      JobName: detail["jobName"],
      RunId: detail.jobRunId
    });

    const result = await glueClient.send(getRunCommand);

    const args = result?.JobRun?.Arguments;
    const state = result?.JobRun.JobRunState;

    const user = args?.["--user"];
    const report = args?.["--report-id"];

    const dynamoReport = await getReportFromDynamo(db, TABLE_NAME, report, ReportVersion.DRAFT, "en");

    switch (state) {
      case "SUCCEEDED": {
        await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, user, EventType.SUCCESS, `Report publish for ${report} succeeded`);

        // pre generate templates and make sure language versions are created

        const settings = await getAdaptSettings(db, SETTINGS_TABLE_NAME, "current");

        const supportedLangs = settings?.supportedLanguages || ["en"];

        const langReports = await Promise.all(supportedLangs.map((lang) => createLanguageVersion({ ...dynamoReport, published: `${Date.now()}` }, lang)));

        // await updateReportVersion(
        //   db,
        //   TABLE_NAME,
        //   { ...dynamoReport, published: `${Date.now()}`, lang: 'en' },
        //   ReportVersion.FINALIZED,
        // );
        // pre generate template

        await Promise.all(supportedLangs.map((lang, idx) => generateInitialTemplate(langReports[idx].slug!, lang)));

        //  await generateInitialTemplate(dynamoReport.slug!, lang)

        await sendPushMessage(`Report publish for ${dynamoReport.name} succeeded`, user, db);
        break;
      }
      case "FAILED":
      case "ERROR": {
        await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, user, EventType.ERROR, `Report publish ${report} failed`);

        await updateReportVersion(db, TABLE_NAME, dynamoReport, ReportVersion.PUBLISH_FAILED);
        await sendPushMessage(`Report publish for ${dynamoReport.name} failed`, user, db, false);
        break;
      }
      // case 'STOPPED':{
      //     await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, user, EventType.ERROR, `Data Pull for ${dataSet} stopped`);

      //     await updateDataSetQueueStatus(db, TABLE_NAME, dataSet, DataSetQueueStatus.STOPPED);
      //     await sendPushMessage(`Data Pull for Data Set ${dynamoDataSet.name} was stopped`, user, db, false)
      //     break;
      // }
    }
  } catch (err) {
    console.error(err);
  }
};

async function sendPushMessage(message: string, id: string, db: DynamoDBDocument, success = true) {
  const sub = await getSubscription(db, NOTIFICATION_TABLE_NAME, id);

  if (sub?.Item) {
    await webpush.sendNotification(sub?.Item.subscription, JSON.stringify({ success, message }));
    // notify the user
  }
}

async function createLanguageVersion(report: IReport, lang: string) {
  let translatedTemplate;
  let translated = await getTemplate(db, report.template.id, lang);

  if (!translated?.Items?.length)
    // create the translated version?
    translatedTemplate = await translateJSON("en", lang, (report as IReport).template, [
      "suppression",
      "type",
      "dataType",
      "condition",
      "default",
      "code",
      "order",
      "field",
      "sortableCategories",
      "id",
      "variables",
      "yAxisLabel",
      "xAxisLabel",
      "xAxisValue",
      "yAxisValue",
      "dataRetrievalOperations",
      "filterOn",
      "chart",
      "conditions"
    ]);
  else translatedTemplate = translated.Items[0];

  report.template = translatedTemplate;

  report.id = `ID#${report.reportID}#Version#finalized#Lang#${lang}`;
  report.lang = lang;
  report.version = "finalized";
  report.slug = slugify(report.name, {
    strict: true,
    lower: true,
    trim: true
  });

  // save the translated report template

  const putParams = {
    TableName: TABLE_NAME,
    Item: report
  };

  await db.put(putParams);

  return report;
}

export async function generateInitialTemplate(slug: string, lang = "en") {
  // get supported langs

  const command = new InvokeCommand({
    FunctionName: RENDER_TEMPLATE_FUNCTION,
    Payload: JSON.stringify({
      accessType: "slug",
      report: slug,
      filters: {},
      lang,
      version: "finalized"
    }),
    LogType: LogType.Tail
  });

  const { Payload } = await lambdaClient.send(command);

  const payloadString = Payload?.transformToString();

  if (!payloadString) return CreateBackendErrorResponse(404, "template could not be found / rendered");

  const payloadResponse = JSON.parse(payloadString);

  if ("statusCode" in payloadResponse && payloadResponse["statusCode"] !== 200) {
    throw new EvalError("failed to render the template");
  }

  await uploadCachedTemplate(slug, {}, payloadResponse); //TODO: make another function to reduce run time?
}

function getHashForTemplate(filters: Record<string, any>) {
  const filterEntries = Object.entries(filters);

  const mappedFilters = filterEntries.map(([key, value]) => `${key}=${value}`);

  let hashableString = mappedFilters.join(",");

  return crypto.createHash("sha256").update(hashableString).digest("hex");
}

async function uploadCachedTemplate(slug: string, filters: Record<string, any>, template: ITemplate) {
  // generate hash

  const hash = getHashForTemplate(filters);
  const putObjectCommand = new PutObjectCommand({
    Bucket: VIEWER_REPORT_CACHE,
    Key: `${slug}/${hash}.json`,
    Body: JSON.stringify(template)
  });

  return await s3Client.send(putObjectCommand);
}

async function getTemplate(db: DynamoDBDocument, templateID: string, lang: string) {
  const params = {
    TableName: process.env.TEMPLATE_TABLE,
    KeyConditionExpression: "#type = :type AND id = :id",
    ExpressionAttributeNames: {
      "#type": "type"
    },
    ExpressionAttributeValues: {
      ":type": "ReportTemplate",
      ":id": `${templateID}#LANG#${lang}`
    }
  };

  return await db.query(params);
}
