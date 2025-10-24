// @ts-nocheck // FIXME: come back and fix typescript errors
import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import {
  CreateBackendResponse,
  CreateBackendErrorResponse,
  createUpdateItemFromObject,
  getDatasourceMetadata,
  getDataView,
  getReportFromDynamo,
  getUserDataFromEvent,
  UserActivity
} from "../../../libs/types/src";
import { DynamoDBClient, ReturnValue } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const USER_TABLE = process.env.USER_TABLE || "";
const REPORT_TABLE = process.env.REPORT_TABLE || "";
const DATA_TABLE = process.env.DATA_TABLE || "";
// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const username = getUserDataFromEvent(event).username;

    const userActivityUpdate = {
      TableName: USER_TABLE,
      Key: {
        username
      }
    };

    const result = await db.get(userActivityUpdate);

    let userActivity = (result.Item as UserActivity) || {};

    // do a check on the cache expiry and if an item updated or not

    if (userActivity.cache && userActivity.cache.action === "EDIT") userActivity = await handleCacheUpdates(db, username, userActivity);

    return CreateBackendResponse(200, result.Item);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "failed to retrieve user activity");
  }
};

async function handleCacheUpdates(db: DynamoDBDocument, username: string, userActivity: UserActivity) {
  const cache = userActivity.cache;

  // if expired just remove
  if (Date.now() > cache.expiry) {
    const userActivityUpdate = {
      TableName: USER_TABLE,
      Key: {
        username
      },
      ReturnValues: ReturnValue.ALL_NEW,
      ...createUpdateItemFromObject({ cache: null })
    };

    const userActivityUpdateResult = await db.update(userActivityUpdate);

    return userActivityUpdateResult.Attributes as UserActivity;
  }

  // check for updated items

  switch (cache.type) {
    case "Report": {
      const report = await getReportFromDynamo(db, REPORT_TABLE, cache.body.reportID, cache.body.version);
      // was updated
      if (report && Number(report.updated) > cache.added) {
        userActivity.cache.dirty = true;
      }
      break;
    }
    case "DataSource": {
      const dataSource = await getDatasourceMetadata(db, DATA_TABLE, cache.body.dataSourceID);
      // was updated
      if (dataSource && Number(dataSource!.updated) > cache.added) {
        userActivity.cache.dirty = true;
      }
      break;
    }
    case "DataView": {
      const dataView = await getDataView(db, DATA_TABLE, cache.body.dataViewID);
      console.log(dataView);
      // was updated
      if (dataView && Number(dataView!.updated) > cache.added) {
        userActivity.cache.dirty = true;
      }
      break;
    }
  }

  return userActivity;
}
