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
    const templateType = event.pathParameters?.["templateType"];
    const templateID = event.pathParameters?.["templateID"];

    if (!templateType) {
      return CreateBackendErrorResponse(400, "Template type is required");
    }

    const validTemplates = ["DataCollection", "ValidationTemplate", "ReportTemplate"];

    if (!validTemplates.includes(templateType)) return CreateBackendErrorResponse(400, "Invalid template type");

    if (!templateID) {
      return getTemplates(db, templateType);
    }

    const params = {
      TableName: TABLE_NAME,
      Key: {
        type: templateType,
        id: `ID#${templateID}`
      }
    };

    const template = await db.get(params);

    if (!template.Item) return CreateBackendErrorResponse(404, "requested template does not exist");

    return CreateBackendResponse(200, template.Item);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to retrieve data sources");
  }
};

async function getTemplates(db: DynamoDBDocument, templateType: string, withLanguages = false) {
  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#type = :type",
    ExpressionAttributeNames: {
      "#type": "type"
    },
    ExpressionAttributeValues: {
      ":type": templateType
    }
  };

  let result, lastKey;
  let accumulated: any[] = [];

  do {
    result = await db.query(params);

    lastKey = result.LastEvaluatedKey;

    accumulated = [...accumulated, ...(result.Items || [])];
  } while (lastKey);

  // Manually filter out the languages options
  if (!withLanguages && templateType === "ReportTemplate") {
    accumulated = accumulated.filter((item) => !item.id.includes("#LANG#"));
  }

  return CreateBackendResponse(200, accumulated || []);
}
