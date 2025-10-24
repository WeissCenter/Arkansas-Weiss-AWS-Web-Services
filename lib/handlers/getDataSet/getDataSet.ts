import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";

// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const dataSetID = event?.pathParameters?.["dataSetID"];

    if (!dataSetID) {
      // get all datasets
      return CreateBackendResponse(200, await getAllDataSets(db));
    }

    // otherwise just get the individual dataset

    const getParams = {
      TableName: TABLE_NAME,
      Key: {
        type: "DataSet",
        id: `ID#${dataSetID}`
      }
    };

    const result = await db.get(getParams);

    if (!result?.Item) {
      return CreateBackendErrorResponse(404, `Dataset ${dataSetID} does not exist`);
    }

    return CreateBackendResponse(200, result.Item);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to get dataset");
  }
};

async function getAllDataSets(db: DynamoDBDocument) {
  const queryParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#type = :type",
    ExpressionAttributeValues: {
      ":type": "DataSet"
    },
    ExpressionAttributeNames: {
      "#type": "type"
    }
  };

  let result, lastKey;
  let accumulated: any[] = [];

  do {
    result = await db.query(queryParams);

    lastKey = result.LastEvaluatedKey;

    accumulated = [...accumulated, ...(result.Items || [])];
  } while (lastKey);

  return accumulated;
}
