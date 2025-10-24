import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, aws_generateDailyLogStreamID, StartUploadDataViewInput } from "../../../libs/types/src";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Define Environment Variables
const STAGING_BUCKET = process.env.STAGING_BUCKET || "";

// AWS SDK Clients
const s3Client = new S3Client({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event.body) {
      return CreateBackendErrorResponse(400, "missing body");
    }

    const body = JSON.parse(event.body) as StartUploadDataViewInput;

    if (!body.fileID || !body.dataViewID || !body.filename) {
      return CreateBackendErrorResponse(400, "invalid input");
    }

    const command = new PutObjectCommand({
      Bucket: STAGING_BUCKET,
      Key: `${body.dataViewID}/${body.fileID}/${body.filename}`
    });

    const signedURL = await getSignedUrl(s3Client, command, {
      expiresIn: 3600
    });

    return CreateBackendResponse(200, signedURL);
  } catch (error) {
    console.log("error", error);
    return CreateBackendErrorResponse(500, error);
  }
};
