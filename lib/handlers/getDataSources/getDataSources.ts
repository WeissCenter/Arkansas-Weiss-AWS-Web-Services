import { DynamoDBClient, QueryInput, ScanInput } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { APIGatewayEvent, Context, Handler } from "aws-lambda";
// eslint-disable-next-line @nx/enforce-module-boundaries
import { DataSource, CreateBackendResponse, CreateBackendErrorResponse } from "../../../libs/types/src";

const TABLE_NAME = process.env.TABLE_NAME;

const client = new DynamoDBClient();
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const dataSources = await getDataSources();
    console.log(event);

    return CreateBackendResponse(200, dataSources);
  } catch (err) {
    return CreateBackendErrorResponse(500, "Failed to retrieve data sources");
  }
};

function cleanFields(dataSource: DataSource) {
  // @ts-ignore
  delete dataSource.connectionInfo;
  return dataSource;
}

async function getDataSources() {
  const scanParams = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#type = :type",
    ExpressionAttributeValues: {
      ":type": "DataSource"
    },
    ExpressionAttributeNames: {
      "#type": "type"
    }
  };

  let result, lastKey;
  let accumulated: any[] = [];

  do {
    result = await db.query(scanParams);

    lastKey = result.LastEvaluatedKey;

    accumulated = [...accumulated, ...(result.Items || [])];
  } while (lastKey);

  return accumulated.map((source) => cleanFields(source));
}
