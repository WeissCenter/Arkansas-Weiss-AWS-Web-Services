import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  aws_generateDailyLogStreamID,
  aws_LogEvent,
  createUpdateItemFromObject,
  EventType,
  getDataCollectionTemplate,
  getUserDataFromEvent,
  NewDataViewInput
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// Define Environment Variables
const TEMPLATES_TABLE = process.env.TEMPLATES_TABLE || "";
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const logStream = aws_generateDailyLogStreamID();
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const newDataView = JSON.parse(event.body) as NewDataViewInput;

    const newDataViewID = newDataView.dataViewID || randomUUID();

    return await handleFileCollection(db, event, newDataView, newDataViewID, logStream, cloudwatch);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to create new data view");
  }
};

function getStatus(view: NewDataViewInput) {
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

  const { username, fullName } = getUserDataFromEvent(event);

  const newDataViewDBItem = {
    dataViewID: newDataViewID,
    author: fullName,
    name: newDataView.name,
    created: Date.now(),
    status: getStatus(newDataView),
    updated: Date.now(),
    description: newDataView.description,
    dataViewType: newDataView.dataViewType,
    data: newDataView.data,
    lastPull: "",
    pulledBy: ""
  };

  const newDataViewParams = {
    TableName: TABLE_NAME,
    Key: {
      type: "DataView",
      id: `ID#${newDataViewID}`
    },
    ...createUpdateItemFromObject(newDataViewDBItem)
  };

  await db.update(newDataViewParams);

  await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `DataView: ${newDataViewID} was created`);

  return CreateBackendResponse(200, newDataViewDBItem);
}
