import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, ShareReport, aws_generateDailyLogStreamID, EventType, aws_LogEvent } from "../../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

// Define Environment Variables
const SHARE_TABLE = process.env.TABLE_NAME || "";
const LOG_GROUP = process.env.LOG_GROUP || "";
// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);
const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  const logStream = aws_generateDailyLogStreamID();

  try {
    if (event.pathParameters && "slug" in event.pathParameters) {
      const getParams = {
        TableName: SHARE_TABLE,
        Key: {
          slug: event.pathParameters["slug"]
        }
      };

      const share = await db.get(getParams);

      if (!share.Item) return CreateBackendErrorResponse(404, "share link does not exist");

      return CreateBackendResponse(200, share.Item);
    }

    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const body = JSON.parse(event.body) as ShareReport;

    const newSlugID = slug(8);

    const newShareItem = {
      slug: newSlugID,
      reportSlug: body.reportSlug,
      filters: body.filters,
      tabIndex: body.tabIndex
    };

    const putParams = {
      TableName: SHARE_TABLE,
      Item: newShareItem
    };

    await db.put(putParams);

    await aws_LogEvent(
      cloudwatch,
      LOG_GROUP,
      logStream,
      "Public User",
      EventType.VIEWER_SHARE,
      `A User created a new share link for report ${body.reportSlug} with filters ${body.filters} for page ${body.tabIndex}`
    );

    return CreateBackendResponse(200, newSlugID);
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to share report");
  }
};

// from nanoid
// https://github.com/ai/nanoid/blob/main/nanoid.js
const a = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export const slug = (e = 21) => {
  let t = "",
    r = crypto.getRandomValues(new Uint8Array(e));
  for (let n = 0; n < e; n++) t += a[63 & r[n]];
  return t;
};
