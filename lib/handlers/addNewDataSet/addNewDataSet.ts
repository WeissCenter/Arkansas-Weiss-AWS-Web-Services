import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  aws_generateDailyLogStreamID,
  DataSet,
  EventType,
  NewDataSetInput,
  aws_LogEvent,
  cleanObject,
  createUpdateItemFromObject,
  getDataSet,
  getUserDataFromEvent
} from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  const logStream = aws_generateDailyLogStreamID();
  const username = getUserDataFromEvent(event).username;

  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const newDataSet = JSON.parse(event.body) as NewDataSetInput;

    const newDataSetID = newDataSet.dataSetID || randomUUID();

    // DataSource#${dataSourceID}#
    const newDataSetDBItem: DataSet = {
      dataSetID: newDataSetID,
      author: username,
      dataSources: newDataSet.dataSources.map((item) => cleanObject(item)),
      dataSourceRelationships: (newDataSet?.dataSourceRelationships || []).filter((item) => item.fromField.length > 0 && item.toField.length > 0 && item.joinType.length > 0),
      name: newDataSet.name,
      created: Date.now(),
      description: newDataSet.description
    };

    const item = await getDataSet(db, TABLE_NAME, newDataSetID);

    if ((item && !arrayEqual(newDataSet?.dataSources || [], item?.dataSources || [])) || !arrayEqual(newDataSet?.dataSourceRelationships || [], item?.dataSourceRelationships || [])) {
      // check if relationships or sources changed

      newDataSetDBItem.lastPull = "";
      newDataSetDBItem.pulledBy = "";
    }

    const newDataSetParams = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataSet",
        id: `ID#${newDataSetID}`
      },
      ...createUpdateItemFromObject(newDataSetDBItem)
    };

    await db.update(newDataSetParams);

    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `DataSet: ${newDataSetID} was created`);

    return CreateBackendResponse(200, newDataSetDBItem);
  } catch (err) {
    console.error(err);
    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, username, EventType.CREATE, `DataSet failed to be created: ${JSON.stringify(err)}`);

    return CreateBackendErrorResponse(500, "Failed to create new dataset");
  }
};

function objectsEqual(o1, o2) {
  return Object.keys(o1).length === Object.keys(o2).length && Object.keys(o1).every((p) => o1[p] === o2[p]);
}

function arrayEqual(a1, a2) {
  return a1.length === a2.length && a1.every((o, idx) => objectsEqual(o, a2[idx]));
}
