import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  DataSetOperationArgument,
  GetDataFromDataViewInput,
  GetDataFromDataViewOutput,
  getDataView,
  getAggregateAthenaResults,
  getReportBySlug,
  getReportFromDynamo,
  ITemplateFilters,
  IFilter,
  IFilterGroup,
  ITemplate,
  ITemplatePage,
  DataView,
  IReport,
  ICondition
} from "../../../../libs/types/src";
import { AthenaClient, Datum, ResultSet, GetQueryResultsCommand, StartQueryExecutionCommand, GetQueryExecutionCommand, QueryExecutionState } from "@aws-sdk/client-athena";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient, InvokeCommand, LogType } from "@aws-sdk/client-lambda";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import crypto from "node:crypto";
import { CreateSessionCommand, DeleteObjectCommand, DeleteObjectCommandOutput, GetObjectCommand, ListObjectsCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Filter } from "aws-cdk-lib/aws-sns";
import { translateJSON } from "../../../../scripts/translate";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const DATA_TABLE = process.env.DATA_TABLE || "";
const RENDER_TEMPLATE_FUNCTION = process.env.RENDER_TEMPLATE_FUNCTION || "";
// const CATALOG = process.env.CATALOG || "";
const CACHE_BUCKET = process.env.CACHE_BUCKET || "";
// const ATHENA_QUERY_RATE = parseInt(process.env.ATHENA_QUERY_RATE || "1000");

// AWS SDK Clients

const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const lambdaClient = new LambdaClient({ region: "us-east-1" });
const athenaClient = new AthenaClient({ region: "us-east-1" });
const s3Client = new S3Client({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const slug = event.pathParameters?.["slug"];
    if (!slug) {
      return CreateBackendErrorResponse(400, "Missing slug");
    }

    const lang = event?.queryStringParameters?.["lang"] || "en";
    const pageId = event?.queryStringParameters?.["pageId"] || undefined;

    let [baseReport, report] = await Promise.all([getReportBySlug(db, slug, TABLE_NAME, undefined, undefined, "en"), getReportBySlug(db, slug, TABLE_NAME, undefined, undefined, lang)]);

    // if the report is not in the specified language, try to translate it
    if (!report && lang !== "en") {
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

      reportClone.id = `ID#${reportClone.reportID}#Version#finalized#Lang#${lang}`;
      reportClone.lang = lang;

      // save the translated report template

      const putParams = {
        TableName: TABLE_NAME,
        Item: reportClone
      };

      await db.put(putParams);

      report = reportClone;
    }

    const dataView = await getDataView(db, DATA_TABLE, report.dataView);

    if (!dataView) {
      return CreateBackendErrorResponse(404, "missing data view in report");
    }

    const filters = event.body ? JSON.parse(event.body) : {};

    // validate filters against the report template
    const validatedFilters: Record<string, any> = {};
    const baseReportTemplate = baseReport.template as ITemplate;
    for (const [key, value] of Object.entries(filters)) {
      console.log(`Validating filter: ${key} = ${value}`);
      const isValidFilterCondition = validateFilterCondition(key, pageId, filters, baseReportTemplate);
      console.log(`Filter ${key} condition is ${isValidFilterCondition ? "valid" : "invalid"}`);
      if (!isValidFilterCondition) {
        console.warn(`Filter ${key} does not meet the condition requirements`);
        continue; // skip filters that do not meet the condition requirements
      }

      // if the filter is valid, add it to the validated filters
      console.log(`Filter ${key} is valid`);
      validatedFilters[key] = value;
    }

    const suppress = event?.queryStringParameters?.["suppressed"] || true; // default to suppressed
    // try to see if we have a cached template

    const cached = await getCachedTemplate(slug, validatedFilters, lang);

    if (!cached) {
      // load and cache if needed from service function
      const command = new InvokeCommand({
        FunctionName: RENDER_TEMPLATE_FUNCTION,
        Payload: JSON.stringify({
          accessType: "slug",
          report: slug,
          filters: validatedFilters,
          suppress,
          version: "finalized",
          lang
        }),
        LogType: LogType.Tail
      });

      const { Payload } = await lambdaClient.send(command);

      const payloadString = Payload?.transformToString();

      if (!payloadString) return CreateBackendErrorResponse(404, "template could not be found / rendered");

      const payloadResponse = JSON.parse(payloadString);
      payloadResponse["filtersUsed"] = validatedFilters;

      if (("statusCode" in payloadResponse && payloadResponse["statusCode"] !== 200) || "errorType" in payloadResponse) {
        throw new EvalError("failed to render the template");
      }

      await uploadCachedTemplate(slug, filters, payloadResponse, lang); //TODO: make another function to reduce run time?

      return CreateBackendResponse(200, payloadResponse);
    }

    return CreateBackendResponse(200, cached);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to retrieve data");
  }
};

async function uploadCachedTemplate(slug: string, filters: Record<string, any>, template: ITemplate, lang: string) {
  // generate hash

  const hash = getHashForTemplate(filters, lang);
  const putObjectCommand = new PutObjectCommand({
    Bucket: CACHE_BUCKET,
    Key: `${slug}/${hash}.json`,
    Body: JSON.stringify(template)
  });

  return await s3Client.send(putObjectCommand);
}

function getHashForTemplate(filters: Record<string, any>, lang: string) {
  const filterEntries = Object.entries({ ...filters, lang });

  const mappedFilters = filterEntries.map(([key, value]) => `${key}=${value}`);

  let hashableString = mappedFilters.join(",");

  return crypto.createHash("sha256").update(hashableString).digest("hex");
}

async function getCachedTemplate(slug: string, filters: Record<string, any>, lang = "en") {
  // generate hash
  try {
    const hash = getHashForTemplate(filters, lang);

    const getItemCommand = new GetObjectCommand({
      Bucket: CACHE_BUCKET,
      Key: `${slug}/${hash}.json`
    });

    const getObject = await s3Client.send(getItemCommand);

    if (!getObject.Body) return;

    const data = await getObject.Body?.transformToString();

    return JSON.parse(data);
  } catch (err) {
    if (err instanceof NoSuchKey) return;

    throw err;
  }
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

function validateFilterCondition(filterKey: string, pageId: string | undefined, filters: any, reportTemplate: ITemplate): boolean {
  const reportFilter = reportTemplate.filters[filterKey] as IFilter<unknown>;
  if (!reportFilter?.condition) return true;
  const { pages, conditions, operator } = reportFilter.condition;

  if (pages?.length && pageId && !pages.includes(pageId)) return false; // If the filter is not applicable to the current page, skip validation
  if (!conditions?.length) return true; // No conditions, no validation needed

  // if the conditions are defined filter based on the validity of the parent filter
  const validConditions = conditions.filter((cond: ICondition) => {
    return cond.parent;
  });

  if (!validConditions.length) return true; // No valid conditions, no validation needed
  switch (operator) {
    case "AND": {
      return validConditions.every((cond: ICondition) => {
        const parentValue = filters[cond.parent];
        return cond.value.includes(parentValue);
      });
    }
    case "OR": {
      return validConditions.some((cond: ICondition) => {
        const parentValue = filters[cond.parent];
        return cond.value.includes(parentValue);
      });
    }
    case "NOR": {
      return !validConditions.some((cond: ICondition) => {
        const parentValue = filters[cond.parent];
        return cond.value.includes(parentValue);
      });
    }
    case "NAND": {
      return !validConditions.every((cond: ICondition) => {
        const parentValue = filters[cond.parent];
        return cond.value.includes(parentValue);
      });
    }
  }
}
