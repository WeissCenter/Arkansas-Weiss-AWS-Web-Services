import { APIGatewayEvent, Context, Handler, S3CreateEvent } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, DataView, getDataCollectionTemplate, getDataView } from "../../../libs/types/src";
import { validate } from "../../../libs/validation/src/index";
import { ValidationTemplate } from "../../../libs/validation/src/lib/types/ValidationTemplate";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import * as xlsx from "xlsx";

// Define Environment Variables
const DATA_SOURCE_TABLE = process.env.DATA_SOURCE_TABLE || "";
const TEMPLATE_TABLE = process.env.TEMPLATE_TABLE || "";
const STAGING_BUCKET = process.env.STAGING_BUCKET || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const s3Client = new S3Client({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent | S3CreateEvent, context: Context) => {
  console.log(event);
  if ((event as S3CreateEvent).Records) {
    const s3Event = event as S3CreateEvent;

    for (const record of s3Event.Records) {
      const { key } = record.s3.object;

      const [dataView] = key.split("/");

      const item = await getDataView(db, DATA_SOURCE_TABLE, dataView);

      if (!item) {
        return CreateBackendErrorResponse(404, "data view not found");
      }

      if (item.dataViewType !== "collection") {
        return CreateBackendErrorResponse(400, "data view type is not supported by validation");
      }

      const collection = await getDataCollectionTemplate(db, TEMPLATE_TABLE, item.data.id);

      if (!collection) {
        return CreateBackendErrorResponse(404, "collection not found");
      }

      if (item.data.files.length !== collection.files.length) {
        console.log("data view and collection mismatch");
        await updateDataView(dataView, item, false, db);
        return CreateBackendErrorResponse(400, "data view and collection mismatch");
      }

      let valid = true;

      try {
        for (const [index, file] of item.data.files.entries()) {
          console.log("file", file);

          if (!file.location?.length || !collection.files[index].validation) continue;

          const getValidationParams = {
            TableName: TEMPLATE_TABLE,
            Key: {
              type: "ValidationTemplate",
              id: `ID#${collection.files[index].validation}`
            }
          };

          const validationResult = await db.get(getValidationParams);

          const validationItem = validationResult.Item as ValidationTemplate;

          const getObjectCommand = new GetObjectCommand({
            Bucket: STAGING_BUCKET,
            Key: `${item.dataViewID}/${file.id}/${file.location}`
          });

          const s3File = await s3Client.send(getObjectCommand);

          if (!s3File.Body) {
            throw new Error("S3 file body is undefined");
          }
          const s3Str = await s3File.Body.transformToString("utf8");

          let toValidate: string | xlsx.WorkBook;

          if (file.location.endsWith(".html")) {
            toValidate = s3Str;
          } else if (file.location.endsWith(".csv")) {
            toValidate = xlsx.read(s3Str, { type: "string" });
          } else {
            throw new Error("invalid file type");
          }

          const errors = validate(toValidate, validationItem);

          console.log("VALIDATION ITEM", validationItem);
          console.log("ERRORS", errors);

          file.errors = errors || [];

          if (file.errors.length) {
            valid = false;
          }
        }
      } catch (err) {
        console.log("failed to validate files", err);
        valid = false;
      }

      await updateDataView(dataView, item, valid, db);

      return;
    }
  }

  try {
    if ((event as APIGatewayEvent).pathParameters) {
      const apiEvent = event as APIGatewayEvent;

      const params = apiEvent.pathParameters;

      if (!params) {
        return CreateBackendErrorResponse(400, "path parameters are missing");
      }
      const dataViewID = params["dataViewID"];
      if (!dataViewID) {
        return CreateBackendErrorResponse(400, "dataViewID is missing");
      }

      const originFile = (event as APIGatewayEvent)?.queryStringParameters?.["originFile"];

      console.log("originFile", originFile);

      const item = await getDataView(db, DATA_SOURCE_TABLE, dataViewID);

      if (!item) {
        return CreateBackendErrorResponse(404, "data view not found");
      }

      if (item.dataViewType !== "collection") {
        return CreateBackendErrorResponse(400, "data view type is not supported by validation");
      }

      const idx = item.data.files.findIndex((file) => file.id === originFile);

      const file = item.data.files[idx];

      if (item.valid === undefined || item.valid === null) {
        return CreateBackendResponse(202, `data file ${originFile} is still being validated`);
      }

      if (!item.valid) {
        console.log("ERRORED FILE", file);
        return CreateBackendErrorResponse(400, file.errors);
      }
      return CreateBackendResponse(200);
    }
  } catch (err) {
    console.log(err);
    return CreateBackendErrorResponse(500, "invalid input");
  }

  return CreateBackendErrorResponse(400, "invalid input");
};

async function updateDataView(dataView: string, item: DataView, valid: boolean, db: DynamoDBDocument) {
  const updateParams = {
    TableName: DATA_SOURCE_TABLE,
    Key: {
      type: "DataView",
      id: `ID#${dataView}`
    },
    UpdateExpression: "SET #data.#files = :files, #valid = :valid",
    ExpressionAttributeNames: {
      "#data": "data",
      "#files": "files",
      "#valid": "valid"
    },
    ExpressionAttributeValues: {
      ":files": item.data.files,
      ":valid": valid
    }
  };

  await db.update(updateParams);
}
