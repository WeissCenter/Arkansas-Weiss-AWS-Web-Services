import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, StartUploadSettingsLogoInput } from "../../../libs/types/src";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Define Environment Variables
const PUBLIC_ASSETS_BUCKET = process.env.PUBLIC_ASSETS_BUCKET || "";

// AWS SDK Clients
const s3Client = new S3Client({ region: "us-east-1" });

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event.body) {
      return CreateBackendErrorResponse(400, "missing body");
    }

    const body = JSON.parse(event.body) as StartUploadSettingsLogoInput;

    if (!body.filename) {
      return CreateBackendErrorResponse(400, "invalid input");
    }

    const command = new PutObjectCommand({
      Bucket: PUBLIC_ASSETS_BUCKET,
      Key: `${body.filename}`
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
