import { Construct } from "constructs";
import { BlockPublicAccess, Bucket, BucketEncryption, EventType, StorageClass } from "aws-cdk-lib/aws-s3";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource, DynamoEventSourceProps } from "aws-cdk-lib/aws-lambda-event-sources";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { AdaptNodeLambda } from "../AdaptNodeLambda";
import path from "path";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { AdaptS3Bucket } from "../AdaptS3Bucket";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as EventsLambdaTarget } from "aws-cdk-lib/aws-events-targets";

interface AdaptAuditBucketProps {
  stage: string;
}

export class AdaptAuditBucket extends Construct {
  private auditFn: AdaptNodeLambda;
  private s3BucketCount = 0;

  constructor(scope: Construct, id: string, props: AdaptAuditBucketProps) {
    super(scope, id);

    const auditBucket = new AdaptS3Bucket(this, "AdaptAuditBucket", {
      bucketName: `${props.stage.toLowerCase()}-adapt-audit-bucket`,
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      lifecycleRules: [
        {
          id: "audit-log-storage-tiering",
          enabled: true,
          transitions: [
            {
              storageClass: StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30)
            },
            {
              storageClass: StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: Duration.days(90)
            }
          ]
        },
        {
          id: "audit-log-version-cleanup",
          enabled: true,
          noncurrentVersionExpiration: Duration.days(730),
          noncurrentVersionTransitions: [
            {
              storageClass: StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: Duration.days(30)
            }
          ],
          expiredObjectDeleteMarker: true
        }
      ]
    });

    this.auditFn = new AdaptNodeLambda(this, "AdaptAuditFunction", {
      prefix: props.stage,
      handler: "handler",
      entry: path.join(__dirname, "auditHandler.ts"),
      environment: {
        AUDIT_BUCKET: auditBucket.bucketName
      }
    });

    auditBucket.grantPut(this.auditFn);
    auditBucket.grantDelete(this.auditFn);
  }

  addDynamodbTableToAudit(
    table: Table,
    eventSourceProps: DynamoEventSourceProps = {
      startingPosition: StartingPosition.TRIM_HORIZON,
      batchSize: 10, // Default batch size for DynamoDB streams
      bisectBatchOnError: true, // Default to true to ensure failed batches are retried in smaller chunks
      retryAttempts: 2 // Default: number of retry attempts for failed batches
    }
  ) {

    if (!table.tableStreamArn) {
      throw new Error(`DynamoDB table ${table.tableName} does not have streams enabled. Please enable streams on the table with at least NEW_IMAGE view type to use it with AdaptAuditBucket.`);
    }
    // Implementation for adding the DynamoDB table to audit
    table.grantStreamRead(this.auditFn);
    this.auditFn.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["dynamodb:DescribeTable"],
      resources: [table.tableArn],
    }));

    this.auditFn.addEventSource(new DynamoEventSource(table, eventSourceProps));
  }

  addS3BucketToAudit(
    bucketName: string,
    events: EventType[] = [EventType.OBJECT_CREATED, EventType.OBJECT_REMOVED]
  ) {
    const count = this.s3BucketCount++;
    // Use EventBridge instead of direct Lambda notifications to avoid conflicts
    // when the bucket already has Lambda notifications for overlapping event types.
    const bucket = Bucket.fromBucketName(Stack.of(this), `AuditBucketRef-${count}`, bucketName);
    bucket.grantRead(this.auditFn);
    bucket.enableEventBridgeNotification();

    const detailTypeMap: Partial<Record<EventType, string>> = {
      [EventType.OBJECT_CREATED]: "Object Created",
      [EventType.OBJECT_REMOVED]: "Object Deleted",
      [EventType.OBJECT_RESTORE_COMPLETED]: "Object Restore Completed",
      [EventType.OBJECT_RESTORE_DELETE]: "Object Restore Expired",
    };
    const detailTypes = events.map(e => detailTypeMap[e]).filter((t): t is string => t !== undefined);

    new Rule(Stack.of(this), `AuditS3Rule-${count}`, {
      eventPattern: {
        source: ["aws.s3"],
        detailType: detailTypes,
        detail: { bucket: { name: [bucketName] } },
      },
      targets: [new EventsLambdaTarget(this.auditFn)],
    });
  }
}
