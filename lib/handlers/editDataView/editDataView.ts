import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  createUpdateItemFromObject,
  EventType,
  DataView,
  getDataCollectionTemplate,
  getDataView,
  getUserDataFromEvent,
  NewDataViewInput
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const logStream = aws_generateDailyLogStreamID();
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const dataView = JSON.parse(event.body) as DataView;

    const dataViewID = event?.pathParameters?.["dataViewID"] || dataView.dataViewID || randomUUID();

    return await handleFileCollection(db, event, dataView, dataViewID, logStream, cloudwatch);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to edit data view");
  }
};

async function getStatus(db: DynamoDBDocument, dataViewID: string, view: NewDataViewInput) {
  const dataView = await getDataView(db, TABLE_NAME, dataViewID);

  if (!dataView) {
    return "MISSING DATA";
  }

  if (dataView.status === "AVAILABLE") {
    return "AVAILABLE";
  }

  if (view.dataViewType === "collection" && view.data.files.every((file) => file.location.length)) {
    return "REQUESTED";
  }

  if (view.dataViewType === "database") {
    return "REQUESTED";
  }

  return "MISSING DATA";
}

async function handleFileCollection(db: DynamoDBDocument, event: APIGatewayEvent, newDataView: NewDataViewInput, newDataViewID: string, logStream: string, cloudwatch: CloudWatchLogsClient) {
  const collection = await getDataCollectionTemplate(db, TEMPLATES_TABLE, newDataView.data.id);

  if (!collection) {
    return CreateBackendErrorResponse(404, `collection ${newDataView.data.id} does not exist`);
  }

  const username = getUserDataFromEvent(event).username;

  const newDataViewDBItem = {
    dataViewID: newDataViewID,
    name: newDataView.name,
    status: await getStatus(db, newDataViewID, newDataView),
    description: newDataView.description,
    dataViewType: newDataView.dataViewType,
    data: newDataView.data,
    updated: Date.now()
  };

  const updateItem = createUpdateItemFromObject(newDataViewDBItem, ["data"]);

  updateItem.ExpressionAttributeNames["#files"] = "files";
  updateItem.ExpressionAttributeNames["#data"] = "data";
  updateItem.ExpressionAttributeNames["#location"] = "location";

  // enforce the frontend can only update the location not the id or errors
  updateItem.UpdateExpression += ", " + newDataViewDBItem.data.files.map((file, idx) => `#data.#files[${idx}].#location = :fileLocation${file.id}`).join(", ");

  for (const file of newDataViewDBItem.data.files) {
    updateItem.ExpressionAttributeValues[`:fileLocation${file.id}`] = file.location;
  }

  const newDataViewParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataView",
      id: `ID#${newDataViewID}`
    },
    ReturnValues: ReturnValue.ALL_NEW,
    ...updateItem
  };

  const dataViewUpdated = await db.update(newDataViewParams);

  let extra = "";

  if (event.queryStringParameters?.["justification"]) {
    extra += `\nJustification: ${event.queryStringParameters?.["justification"]}`;
  }

  await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `DataView: ${newDataViewID} was edited${extra}`);

  return CreateBackendResponse(200, dataViewUpdated.Attributes);
}
