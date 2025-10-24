import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptS3Bucket } from "../constructs/AdaptS3Bucket";
import { BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { S3Table, Database, Job, Schema, JobExecutable, Code, GlueVersion, PythonVersion, WorkerType } from "@aws-cdk/aws-glue-alpha";
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { CfnCrawler } from "aws-cdk-lib/aws-glue";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule } from "aws-cdk-lib/aws-events";
import { AdaptStackProps } from "./adpat-stack-props";

// playground stack
export class AdaptCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AdaptStackProps) {
    super(scope, id, props);

    const testBucket = new AdaptS3Bucket(this, `${id}-TestBucket`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: `${id}-TestBucket`.toLowerCase()
    });

    const database = new Database(this, `${id}-Database`, {
      databaseName: `${id}-Database`.toLowerCase(),
      description: "Database Description"
    });

    const dataSourceTable = new Table(this, `${id}-adapt-data-source-table`, {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      tableName: `${id}--adapt-data-source-table`,
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // glue crawler/job
    const gluePolicy = new Policy(this, `${id}-GluePolicy`, {
      statements: [
        new PolicyStatement({
          actions: ["iam:*"],
          effect: Effect.ALLOW,
          resources: ["*"]
        }),
        new PolicyStatement({
          actions: ["glue:*"],
          effect: Effect.ALLOW,
          resources: ["*"]
        }),
        new PolicyStatement({
          actions: ["s3:*"],
          effect: Effect.ALLOW,
          resources: ["*"]
        }),
        new PolicyStatement({
          actions: ["dynamodb:*"],
          effect: Effect.ALLOW,
          resources: ["*"]
        }),
        new PolicyStatement({
          actions: ["logs:*"],
          effect: Effect.ALLOW,
          resources: ["*"]
        })
      ]
    });
    const dataSourceGlueRole = new Role(this, `${id}-DataSourceGlueRole`, {
      assumedBy: new ServicePrincipal("glue.amazonaws.com")
    });
    dataSourceGlueRole.attachInlinePolicy(gluePolicy);

    const adaptDataPullCrawler = new CfnCrawler(this, "glue-crawler-s3", {
      name: `${id}-adapt-data-catalog`,
      role: dataSourceGlueRole.roleName,
      targets: {
        s3Targets: [
          {
            path: `${testBucket.bucketName}`
          }
        ]
      },
      databaseName: database.databaseName,
      schemaChangePolicy: {
        updateBehavior: "UPDATE_IN_DATABASE",
        deleteBehavior: "DEPRECATE_IN_DATABASE"
      }
    });

    // Upload the script to the S3 bucket
    const uploadedScriptObject = new BucketDeployment(this, `${id}-PythonScripts`, {
      sources: [Source.asset(`scripts`)],
      destinationBucket: testBucket,
      destinationKeyPrefix: "scripts"
    });

    const glueJob = new Job(this, `${id}-GlueJob`, {
      jobName: `${id}-GlueJob`.toLowerCase(),
      role: dataSourceGlueRole,
      maxRetries: 0,
      maxConcurrentRuns: 5,
      executable: JobExecutable.pythonEtl({
        glueVersion: GlueVersion.V4_0,
        pythonVersion: PythonVersion.THREE,
        script: Code.fromBucket(testBucket, `scripts/dataPull.py`)
      }),
      defaultArguments: {
        "--extra-py-files": `s3://${testBucket.bucketName}/${id}-adapt-data-pull-lib.zip`,
        "--additional-python-modules": "sql-metadata,lxml,beautifulsoup4",
        "--data-pull-s3": testBucket.bucketName,
        "--data-set-id": "default",
        "--table-name": dataSourceTable.tableName,
        "--data-staging-s3": testBucket.bucketName, // change to stage bucket eventually
        "--data-pull-crawler": adaptDataPullCrawler.name || `${id}-adapt-data-catalog`,
        "--user": "default"
      },
      workerType: WorkerType.STANDARD,
      workerCount: 2
    });

    // this event will trigger a Lambda function to perform a data pull
    const dataPullJobStateChangeRule = new Rule(this, `${id}-adapt-data-pull-state-change-rule-cdk`, {
      eventPattern: {
        source: ["aws.glue"],
        detailType: [`Glue Job State Change`],
        detail: {
          jobName: [glueJob.jobName],
          state: ["SUCCEEDED", "FAILED", "STOPPED"]
        }
      }
    });
  }
}
