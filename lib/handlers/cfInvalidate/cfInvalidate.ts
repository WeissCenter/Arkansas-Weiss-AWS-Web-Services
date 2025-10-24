import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";

const DISTRIBUTION_ID = process.env.DISTRIBUTION_ID!;
const PATH = ["/*"];

const client = new CloudFrontClient({});

export const handler = async (event: any) => {
  console.log("Received EventBridge event:", JSON.stringify(event, null, 2));

  const callerReference = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const cmd = new CreateInvalidationCommand({
    DistributionId: DISTRIBUTION_ID,
    InvalidationBatch: {
      CallerReference: callerReference,
      Paths: {
        Quantity: PATH.length,
        Items: PATH
      }
    }
  });

  //const result = await client.send(cmd);
  //console.log("CloudFront invalidation created:", result.Invalidation?.Id);

  //return { status: "ok", invalidationId: result.Invalidation?.Id };
  return;
};
