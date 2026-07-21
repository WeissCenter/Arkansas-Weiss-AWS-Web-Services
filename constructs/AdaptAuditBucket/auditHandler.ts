import {
  DynamoDBStreamEvent,
  DynamoDBRecord,
  S3ObjectCreatedNotificationEvent,
  S3ObjectDeletedNotificationEvent,
} from "aws-lambda";
import { S3Client, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, DescribeTableCommand, KeyType } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const AUDIT_BUCKET = process.env.AUDIT_BUCKET || "";

type S3AuditEvent = S3ObjectCreatedNotificationEvent | S3ObjectDeletedNotificationEvent;

interface TableKeySchema {
  partitionKey: string;
  sortKey?: string;
}
const tableSchemaCache = new Map<string, TableKeySchema>();

async function getTableKeySchema(tableName: string): Promise<TableKeySchema> {
  const cached = tableSchemaCache.get(tableName);
  if (cached) return cached;

  const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
  const keySchema = Table?.KeySchema ?? [];
  const schema: TableKeySchema = {
    partitionKey: keySchema.find(k => k.KeyType === KeyType.HASH)?.AttributeName ?? "pk",
    sortKey: keySchema.find(k => k.KeyType === KeyType.RANGE)?.AttributeName,
  };
  tableSchemaCache.set(tableName, schema);
  return schema;
}

export const handler = async (event: DynamoDBStreamEvent | S3AuditEvent): Promise<void> => {
  console.log("Received event", JSON.stringify(event));
  if ("Records" in event) {
    for (const record of event.Records) {
      try {
        await processDynamoDBStreamRecord(record);
      } catch (err) {
        console.error("Failed to process DynamoDB record", JSON.stringify(record), err);
        throw err;
      }
    }
  } else {
    try {
      await processS3EventBridgeEvent(event);
    } catch (err) {
      console.error("Failed to process S3 EventBridge event", JSON.stringify(event), err);
      throw err;
    }
  }
};

async function processS3EventBridgeEvent(event: S3AuditEvent): Promise<void> {
  const bucketName = event.detail.bucket.name;
  const objectKey = event.detail.object.key;
  const auditKey = `s3/${bucketName}/${objectKey}`;

  if (event["detail-type"] === "Object Created") {
    // EventBridge keys are not URL-encoded; encode for CopySource
    const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
    await s3.send(new CopyObjectCommand({
      Bucket: AUDIT_BUCKET,
      Key: auditKey,
      CopySource: `${bucketName}/${encodedKey}`,
    }));
    console.log(`Audit copy created: s3://${AUDIT_BUCKET}/${auditKey}`);
  } else {
    await s3.send(new DeleteObjectCommand({
      Bucket: AUDIT_BUCKET,
      Key: auditKey,
    }));
    console.log(`Audit copy deleted: s3://${AUDIT_BUCKET}/${auditKey}`);
  }
}

async function processDynamoDBStreamRecord(record: DynamoDBRecord): Promise<void> {
  console.log("Processing DynamoDB Stream Record", JSON.stringify(record));
  switch (record.eventName) {
    case "INSERT":
    case "MODIFY": {
      const key = await auditBucketDynamoDBStreamEventObjectKey(record);
      await s3.send(new PutObjectCommand({
        Bucket: AUDIT_BUCKET,
        Key: key,
        Body: JSON.stringify(record.dynamodb?.NewImage, null, 2),
        ContentType: "application/json",
      }));
      console.log(`Audit record written: s3://${AUDIT_BUCKET}/${key}`);
      break;
    }
    case "REMOVE": {
      const key = await auditBucketDynamoDBStreamEventObjectKey(record);
      await s3.send(new DeleteObjectCommand({
        Bucket: AUDIT_BUCKET,
        Key: key,
      }));
      console.log(`Audit record deleted: s3://${AUDIT_BUCKET}/${key}`);
      break;
    }
    default:
      throw new Error(`Unknown DynamoDB event name: ${record.eventName}`);
  }
}

async function auditBucketDynamoDBStreamEventObjectKey(dynamoRecord: DynamoDBRecord): Promise<string> {
  const tableName = dynamoRecord?.eventSourceARN?.split("/")?.[1] || "unknown-table";
  const keys = dynamoRecord?.dynamodb?.Keys ?? {};
  const schema = await getTableKeySchema(tableName);

  const pkValue = keys[schema.partitionKey]?.S ?? keys[schema.partitionKey]?.N ?? "unknown-pk";
  const skValue = schema.sortKey ? (keys[schema.sortKey]?.S ?? keys[schema.sortKey]?.N) : undefined;

  const keyPath = skValue ? `${pkValue}/${skValue}` : pkValue;
  return `dynamodb/${tableName}/${keyPath}.json`;
}
