import { APIGatewayEvent, Context, Handler } from "aws-lambda";
// eslint-disable-next-line @nx/enforce-module-boundaries

import { DynamoDBClient, UpdateItemInput } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import {
  aws_generateDailyLogStreamID,
  getUserDataFromEvent,
  EventType,
  CreateBackendErrorResponse,
  IReport,
  getReportVersionsFromDynamo,
  ReportVersion,
  aws_LogEvent,
  CreateBackendResponse,
  createUpdateItemFromObject,
  LanguageCode,
  getReportFromDynamo
} from "../../../libs/types/src";
import { DeleteObjectCommandOutput, ListObjectsV2Command, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { translateJSON } from "../../../scripts/translate";

const s3Client = new S3Client({ region: "us-east-1" });
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const logStream = aws_generateDailyLogStreamID();
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  const { username } = getUserDataFromEvent(event);

  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const body = JSON.parse(event.body) as {
      reportID: string;
      languages: { [lang: string]: IReport & { verified: boolean } };
    };

    const baseReport = await getReportFromDynamo(db, process.env.REPORT_TABLE || "", body.reportID, ReportVersion.DRAFT, "en");

    if (!baseReport) return CreateBackendErrorResponse(404, `Report ${body.reportID} does not exist`);

    for (const [lang, report] of Object.entries(body.languages)) {
      let cursor = report;

      const dynamoReports = (await getReportVersionsFromDynamo(db, process.env.REPORT_TABLE || "", body.reportID)) as IReport[];

      let dynamoReportForLang = dynamoReports.find((rpt) => rpt.version === ReportVersion.DRAFT && rpt.lang === lang);

      if (!dynamoReportForLang) {
        let translatedTemplate;
        let translated = await getTemplate(db, baseReport.template.id, lang);

        if (!translated?.Items?.length)
          // create the translated version?
          translatedTemplate = await translateJSON("en", lang, (baseReport as IReport).template, [
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

        const reportClone = structuredClone(baseReport) as any;

        reportClone.template = translatedTemplate;
        reportClone.lang = lang;

        reportClone.id = `ID#${body.reportID}#Version#draft#Lang#${lang}`;

        // save the translated report template
        const putParams = {
          TableName: process.env.REPORT_TABLE || "",
          Item: { ...reportClone, translationsVerified: false }
        };
        await db.put(putParams);
        dynamoReportForLang = reportClone;
      }

      cursor = {
        ...dynamoReportForLang,
        ...report,
        template: {
          ...dynamoReportForLang?.template!,
          title: report.template.title,
          description: report.template.description
        }
      };

      const date = Date.now();

      const updateReportItem = {
        updated: `${date}`,
        version: "draft",
        template: cursor.template,
        visibility: cursor.visibility,
        name: cursor.name,
        lang: lang,
        translationsVerified: cursor.verified || false,
        slug: cursor.slug
      };

      // clear out any cache for this report
      await deleteFolder([`${body.reportID}/draft`], process.env.CACHE_BUCKET || "");

      const finalizedVersion = dynamoReports.find((rpt) => rpt.version === ReportVersion.FINALIZED);

      if (finalizedVersion) await handleFinalizedVersion(db, finalizedVersion, date);

      const [draftResult, draftAudit] = await handleDraftReport(db, cursor, updateReportItem, lang);
    }

    await aws_LogEvent(cloudwatch, process.env.LOG_GROUP || "", logStream, username, EventType.CREATE, `Report: ${body.reportID} was edited and new draft version was created`);

    return CreateBackendResponse(200);
  } catch (err) {
    console.log(err);
    return CreateBackendErrorResponse(500, "Failed to edit report");
  }
};

function handleDraftReport(db: DynamoDBDocument, body: IReport, updateReportItem: any, lang = "en") {
  const updateReportParams = {
    TableName: process.env.REPORT_TABLE,
    Key: {
      type: "Report",
      id: `ID#${body.reportID}#Version#draft${lang ? `#Lang#${lang}` : ""}`
    },
    ReturnValues: "ALL_NEW",
    ...createUpdateItemFromObject(updateReportItem)
  };

  const updateAuditReport = {
    TableName: process.env.REPORT_TABLE,
    Key: {
      type: "Report",
      id: `ID#${body.reportID}#Version#draft${lang ? `#Lang#${lang}` : ""}-${body.updated}`
    },
    ...createUpdateItemFromObject({ ...body, version: `draft-${body.updated}`, lang }, ["id", "type"])
  };
  return Promise.all([db.update(updateReportParams), db.update(updateAuditReport)]);
}

async function handleFinalizedVersion(db: DynamoDBDocument, report: IReport, date: number) {
  const deleteOldFinalized = {
    TableName: process.env.REPORT_TABLE,
    Key: {
      type: "Report",
      id: `ID#${report.reportID}#Version#finalized${report.lang ? `#Lang#${report.lang}` : ""}`
    }
  };

  const updateAuditReport = {
    TableName: process.env.REPORT_TABLE,
    Key: {
      type: "Report",
      id: `ID#${report.reportID}#Version#finalized${report.lang ? `#Lang#${report.lang}` : ""}-${date}`
    },
    ...createUpdateItemFromObject({ ...report, version: `finalized-${date}` }, ["id", "type"])
  };
  return Promise.all([db.delete(deleteOldFinalized), db.update(updateAuditReport)]);
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

async function deleteFolder(keys: string[], bucketName: string, partial = false): Promise<void> {
  const DeletePromises: Promise<DeleteObjectCommandOutput>[] = [];

  for (const key of keys) {
    const { Contents } = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: key + partial ? "" : "/"
      })
    );

    if (!Contents) continue;

    for (const object of Contents) {
      DeletePromises.push(
        s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: object.Key
          })
        )
      );
    }
  }

  await Promise.all(DeletePromises);
}
