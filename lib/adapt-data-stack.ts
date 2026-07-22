import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptStackProps } from "./adpat-stack-props";
import { Database, PySparkEtlJob, Code, GlueVersion, WorkerType, Connection, ConnectionType } from "@aws-cdk/aws-glue-alpha";
import { CfnCrawler } from "aws-cdk-lib/aws-glue";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { HttpMethods } from "aws-cdk-lib/aws-s3";
import { AdaptS3Bucket } from "../constructs/AdaptS3Bucket";
import { Effect, Policy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { AdaptDynamoTable } from "../constructs/AdaptDynamoTable";
import { Rule } from "aws-cdk-lib/aws-events";
import { AdaptPythonLambda } from "../constructs/AdaptPythonLambda";
import { AdaptNodeLambda } from "../constructs/AdaptNodeLambda";
import path from "path";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { AssetCode, LayerVersion } from "aws-cdk-lib/aws-lambda";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as s3express from "aws-cdk-lib/aws-s3express";
interface AdaptDataStackProps extends AdaptStackProps {
  dynamoTables: { [key: string]: AdaptDynamoTable };
  vapidKeys: {
    publicKey: string;
    privateKey: string;
  };
  logGroup: LogGroup;
  // Glue Data VPC networking (from AdaptNetworkStack). When present, the data-pull
  // job is associated with a NETWORK connection placed in this subnet/SG so Glue
  // runs it inside the VPC and it can reach client DBs over the Site-to-Site VPN.
  // Undefined when client DB connectivity is disabled (ENABLE_CLIENT_DB_VPN).
  glueVpc?: ec2.IVpc;
  glueSubnet?: ec2.ISubnet;
  glueSecurityGroup?: ec2.ISecurityGroup;
}

export class AdaptDataStack extends cdk.Stack {
  stagingBucket: AdaptS3Bucket;
  repoBucket: AdaptS3Bucket;
  repoBucketName: string;
  queryResultBucket: AdaptS3Bucket;
  assetsBucket: AdaptS3Bucket;
  reportDataBucket: AdaptS3Bucket;
  dataCatalog: Database;
  renderTemplateServiceFunction: AdaptNodeLambda;
  dataPullJob: PySparkEtlJob;
  publishJob: PySparkEtlJob;
  dataSourceGlueRole: Role;
  suppressionServiceFunctionName: string;
  stagingBucketName: string;
  loggingStatement: PolicyStatement;
  adminReportCache: s3express.CfnDirectoryBucket;
  viewerReportCache: s3express.CfnDirectoryBucket;
  constructor(scope: Construct, id: string, props: AdaptDataStackProps) {
    super(scope, id, props);

    this.loggingStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["logs:*"],
      resources: [props.logGroup.logGroupArn]
    });

    const adaptDataCatalog = new Database(this, `AdaptDataCatalog`, {
      databaseName: `${id}-AdaptDataCatalog`.toLowerCase(),
      description: "Adapt Data Catalog"
    });
    this.dataCatalog = adaptDataCatalog;

    this.repoBucketName = `${id}-AdaptDataRepositoryBucket`.toLowerCase();
    const repositoryBucket = new AdaptS3Bucket(this, `AdaptDataRepositoryBucket`, {
      bucketName: this.repoBucketName
    });
    this.repoBucket = repositoryBucket;

    const stagingBucket = new AdaptS3Bucket(this, `AdaptDataStagingBucket`, {
      bucketName: `${id}-AdaptDataStagingBucket`,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: ["*"],
          exposedHeaders: ["x-amz-server-side-encryption", "x-amz-request-id", "x-amz-id-2"],
          maxAge: 3000
        }
      ]
    });
    this.stagingBucket = stagingBucket;
    this.stagingBucketName = stagingBucket.bucketName!;

    const queryResultBucket = new AdaptS3Bucket(this, `AdaptQueryResultBucket`, {
      bucketName: `${id}-AdaptQueryResultBucket`
    });
    this.queryResultBucket = queryResultBucket;

    const assetsBucket = new AdaptS3Bucket(this, `AdaptAssetsBucket`, {
      bucketName: `${id}-AdaptAssetsBucket`
    });
    this.assetsBucket = assetsBucket;

    const reportDataBucket = new AdaptS3Bucket(this, `AdaptReportDataBucket`, {
      bucketName: `${id}-AdaptReportDataBucket`
    });
    this.reportDataBucket = reportDataBucket;

    // S3 Express Cache Buckets

    const viewerReportCache = new s3express.CfnDirectoryBucket(this, "adaptViewerReportTemplateCache", {
      bucketName: `${id}-v-rpt-cache--use1-az4--x-s3`.toLowerCase(),
      dataRedundancy: "SingleAvailabilityZone",
      locationName: "use1-az4"
    });
    this.viewerReportCache = viewerReportCache;

    const adminReportCache = new s3express.CfnDirectoryBucket(this, "adaptAdminReportTemplateCache", {
      bucketName: `${id}-a-rpt-cache--use1-az4--x-s3`.toLowerCase(),
      dataRedundancy: "SingleAvailabilityZone",
      locationName: "use1-az4"
    });
    this.adminReportCache = adminReportCache;

    const gluePolicy = new Policy(this, `${id}-GluePolicy`, {
      statements: [
        new PolicyStatement({
          actions: ["iam:*"], // TODO: limit the actions
          effect: Effect.ALLOW,
          resources: ["*"] // TODO: determine the correct resources
        }),
        new PolicyStatement({
          actions: ["glue:*"], // TODO: limit the actions
          effect: Effect.ALLOW,
          resources: ["*"] // TODO: determine the correct resources
        }),
        new PolicyStatement({
          actions: ["s3:*"], // TODO: limit the actions
          effect: Effect.ALLOW,
          resources: ["*"] // TODO: determine the correct resources
        }),
        new PolicyStatement({
          actions: ["dynamodb:*"], // TODO: limit the actions
          effect: Effect.ALLOW,
          resources: ["*"] // TODO: determine the correct resources
        }),
        new PolicyStatement({
          actions: ["logs:*"], // TODO: limit the actions
          effect: Effect.ALLOW,
          resources: ["*"] // TODO: determine the correct resources
        }),
        // Required for Glue jobs/crawlers that use a VPC-bound connection (external
        // client DBs): Glue creates ENIs in the Glue Data VPC subnet to reach the DB
        // over the Site-to-Site VPN. Without these the in-VPC run fails immediately.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "ec2:CreateNetworkInterface",
            "ec2:DeleteNetworkInterface",
            "ec2:DescribeNetworkInterfaces",
            "ec2:DescribeSubnets",
            "ec2:DescribeSecurityGroups",
            "ec2:DescribeVpcs",
            "ec2:DescribeVpcEndpoints",
            "ec2:DescribeRouteTables",
            "ec2:DescribeDhcpOptions",
            "ec2:CreateTags",
            "ec2:DeleteTags"
          ],
          resources: ["*"] // ENI/Describe actions do not support resource-level scoping
        }),
        // The Glue connection references the per-source secret via SECRET_ID; the
        // job/crawler role resolves the credentials at connect time.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["secretsmanager:GetSecretValue"],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:*_SQLConnectionCredentials-*`]
        })
      ]
    });

    const dataSourceGlueRole = new Role(this, `${id}-DataSourceGlueRole`, {
      assumedBy: new ServicePrincipal("glue.amazonaws.com"),
      inlinePolicies: {
        gluePolicy: gluePolicy.document
      }
    });

    this.dataSourceGlueRole = dataSourceGlueRole;

    const adaptDataPullCrawler = new CfnCrawler(this, "AdaptDataCrawler", {
      name: `${id}-AdaptDataCrawler`,
      role: dataSourceGlueRole.roleArn,
      configuration: JSON.stringify({
        Version: 1.0,
        Grouping: {
          TableLevelConfiguration: 2
        }
      }),
      targets: {
        s3Targets: [
          {
            path: repositoryBucket.bucketName
          }
        ]
      },
      databaseName: adaptDataCatalog.databaseName,
      schemaChangePolicy: {
        updateBehavior: "UPDATE_IN_DATABASE",
        deleteBehavior: "LOG"
      }
    });

    const adaptReportCrawler = new CfnCrawler(this, "AdaptReportCrawler", {
      name: `${id}-AdaptReportCrawler`,
      role: dataSourceGlueRole.roleArn,
      configuration: JSON.stringify({
        Version: 1.0,
        Grouping: {
          TableLevelConfiguration: 2
        }
      }),
      targets: {
        s3Targets: [
          {
            path: reportDataBucket.bucketName
          }
        ]
      },
      databaseName: adaptDataCatalog.databaseName,
      schemaChangePolicy: {
        updateBehavior: "UPDATE_IN_DATABASE",
        deleteBehavior: "LOG"
      }
    });

    const uploadedDataPullLibObject = new BucketDeployment(this, `${id}-DataPullLib`, {
      sources: [Source.asset(`libs/adapt-data-pull-lib.zip`)],
      destinationBucket: assetsBucket,
      extract: false,
      destinationKeyPrefix: "libs"
    });

    // Pre-built pure-Python deps shipped on --extra-py-files (built by the CI "Zip
    // Python Dependencies" step): the job runs in the isolated VPC subnet, so
    // --additional-python-modules can't reach PyPI.
    // Distinct prefix ("deps" vs "libs") is required: BucketDeployment defaults to
    // prune:true (`s3 sync --delete` over its prefix), so two deployments sharing a
    // prefix delete each other's zip — the loser 404s at job launch.
    const uploadedDataPullDepsObject = new BucketDeployment(this, `${id}-DataPullDeps`, {
      sources: [Source.asset(`libs/adapt-data-pull-deps.zip`)],
      destinationBucket: assetsBucket,
      extract: false,
      destinationKeyPrefix: "deps"
    });

    // const uploadedReportPublishLibObject = new BucketDeployment(
    //   this,
    //   `${id}-DataPullLib`,
    //   {
    //     sources: [Source.asset(`libs/adapt-report-publish-lib.zip`)],
    //     destinationBucket: assetsBucket,
    //     extract: false,
    //     destinationKeyPrefix: "libs",
    //   }
    // );

    // A Glue job's VPC placement comes ONLY from connections on its definition
    // (StartJobRun has no Connections field; --connections is not a job arg). This
    // placement-only NETWORK connection boots the pull inside the Glue Data VPC so it
    // reaches client DBs over the VPN; dataPull.py still picks the per-source JDBC
    // connection at runtime. All source connections share this subnet/SG, so one suffices.
    const glueVpcConnection =
      props.glueSubnet && props.glueSecurityGroup
        ? new Connection(this, `${id}-GlueVpcConnection`, {
            type: ConnectionType.NETWORK,
            subnet: props.glueSubnet,
            securityGroups: [props.glueSecurityGroup]
          })
        : undefined;

    const adaptDataPullJob = new PySparkEtlJob(this, `${id}-AdaptDataPullJob`, {
      jobName: `${id}-AdaptDataPullJob`,
      role: dataSourceGlueRole,
      maxRetries: 0,
      maxConcurrentRuns: 5,
      glueVersion: GlueVersion.V4_0,
      script: Code.fromAsset(`scripts/dataPull.py`),
      ...(glueVpcConnection ? { connections: [glueVpcConnection] } : {}),
      defaultArguments: {
        "--extra-py-files": `s3://${assetsBucket.bucketName}/libs/${cdk.Fn.select(0, uploadedDataPullLibObject.objectKeys)},s3://${assetsBucket.bucketName}/deps/${cdk.Fn.select(0, uploadedDataPullDepsObject.objectKeys)}`,
        "--data-pull-s3": repositoryBucket.bucketName,
        "--data-set-id": "default",
        "--table-name": props.dynamoTables["dataSourceTable"].tableName,
        "--templates-table-name": props.dynamoTables["templatesTable"].tableName,
        "--settings-table-name": props.dynamoTables["settingsTable"].tableName,
        "--data-staging-s3": stagingBucket.bucketName,
        "--data-pull-crawler": adaptDataPullCrawler.name || `${id}-adapt-data-catalog`,
        "--user": "default"
      },
      workerType: WorkerType.STANDARD,
      numberOfWorkers: 2
    });
    this.dataPullJob = adaptDataPullJob;

    const adaptPublishReportJob = new PySparkEtlJob(this, `${id}-AdaptPublishReportJob`, {
      jobName: `${id}-AdaptPublishReportJob`,
      role: dataSourceGlueRole,
      maxRetries: 0,
      maxConcurrentRuns: 5,
      glueVersion: GlueVersion.V4_0,
      script: Code.fromAsset(`scripts/publish.py`),
      defaultArguments: {
        "--additional-python-modules": "sql-metadata,numpy,dar-tool==1.0.6,pandas",
        "--data-pull-s3": repositoryBucket.bucketName,
        "--report-id": "default",
        "--settings-table-name": props.dynamoTables["settingsTable"].tableName,
        "--glue-database": adaptDataCatalog.databaseName,
        "--table-name": props.dynamoTables["reportTable"].tableName,
        "--report-data-s3": reportDataBucket.bucketName,
        "--published-report-data-crawler": adaptReportCrawler.name!,
        "--user": "default"
      },
      workerType: WorkerType.R_2X,
      numberOfWorkers: 2
    });
    this.publishJob = adaptPublishReportJob;

    const dataPullJobStateChangeRule = new Rule(this, `${id}-adapt-data-pull-state-change-rule-cdk`, {
      eventPattern: {
        source: ["aws.glue"],
        detailType: [`Glue Job State Change`],
        detail: {
          jobName: [adaptDataPullJob.jobName],
          state: ["SUCCEEDED", "FAILED", "STOPPED"]
        }
      }
    });

    const publishReportJobStateChangeRule = new Rule(this, `${id}-adapt-publish-report-state-change-rule-cdk`, {
      eventPattern: {
        source: ["aws.glue"],
        detailType: [`Glue Job State Change`],
        detail: {
          jobName: [adaptPublishReportJob.jobName],
          state: ["SUCCEEDED", "FAILED", "STOPPED"]
        }
      }
    });

    const dataSuppressionLambdaLayer = new LayerVersion(this, `${id}-adapt-suppression-service-layer`, {
      compatibleRuntimes: [Runtime.PYTHON_3_12],
      code: new AssetCode(path.join(__dirname, "layers", "suppress-layer", "lib.zip")),
      description: "suppression service dependencies"
    });

    const dataSuppressionServiceFunction = new AdaptPythonLambda(this, "DataSuppressionService", {
      layers: [dataSuppressionLambdaLayer],
      prefix: props.stage,
      codePath: "./services/dataSuppress/",
      handler: "dataSuppress.handler"
    });
    this.suppressionServiceFunctionName = dataSuppressionServiceFunction.functionName;

    const dataPullJobStatusHandler = new AdaptNodeLambda(this, "DataPullJobStatusHandler", {
      prefix: props.stage,
      handler: "handler",
      entry: path.join(__dirname, ".", "./handlers/dataPullJobStatus/dataPullJobStatus.ts"),
      attachPolicies: [
        new Policy(this, "dataPullJobStatus", {
          statements: [
            this.loggingStatement,
            new PolicyStatement({
              actions: ["glue:GetJobRun"],
              effect: Effect.ALLOW,
              resources: ["*"]
            }),
            new PolicyStatement({
              actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
              effect: Effect.ALLOW,
              resources: [props.dynamoTables["dataSourceTable"].tableArn]
            }),
            new PolicyStatement({
              actions: ["dynamodb:GetItem"],
              effect: Effect.ALLOW,
              resources: [props.dynamoTables["pushNotificationsTable"].tableArn]
            }),
            new PolicyStatement({
              actions: ["dynamodb:Query"],
              effect: Effect.ALLOW,
              resources: [props.dynamoTables["reportTable"].tableArn]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:*", "s3express:*"], // TODO: restrict
              resources: [adminReportCache.attrArn, `${adminReportCache.attrArn}/*`]
            })
          ]
        })
      ],
      environment: {
        TABLE_NAME: props.dynamoTables["dataSourceTable"].tableName,
        NOTIFICATION_TABLE_NAME: props.dynamoTables["pushNotificationsTable"].tableName,
        LOG_GROUP: props.logGroup.logGroupName,
        PUBLIC_VAPID_KEY: props.vapidKeys.publicKey,
        PRIVATE_VAPID_KEY: props.vapidKeys.privateKey,
        REPORT_TABLE: props.dynamoTables["reportTable"].tableName,
        REPORT_CACHE_BUCKET: this.adminReportCache.bucketName!
      },
      nodeModules: ["web-push"]
    });
    dataPullJobStateChangeRule.addTarget(new LambdaFunction(dataPullJobStatusHandler));

    this.renderTemplateServiceFunction = new AdaptNodeLambda(this, "renderTemplateService", {
      memorySize: 2048,
      timeout: cdk.Duration.seconds(60),
      prefix: props.stage,
      handler: "handler",
      entry: path.join(__dirname, ".", "./services/renderTemplate/renderTemplate.ts"),
      attachPolicies: [
        new Policy(this, "renderTemplateServicePolicy", {
          statements: [
            this.loggingStatement,
            new PolicyStatement({
              actions: ["glue:*"],
              effect: Effect.ALLOW,
              resources: ["*"]
            }),
            new PolicyStatement({
              actions: ["lambda:InvokeFunction"],
              effect: Effect.ALLOW,
              resources: [dataSuppressionServiceFunction.functionArn]
            }),
            new PolicyStatement({
              actions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Query"],
              effect: Effect.ALLOW,
              resources: [
                props.dynamoTables["dataSourceTable"].tableArn,
                props.dynamoTables["reportTable"].tableArn,
                props.dynamoTables["settingsTable"].tableArn,
                `${props.dynamoTables["reportTable"].tableArn}/index/report-slug-query`
              ]
            }),
            new PolicyStatement({
              actions: ["s3:*"],
              effect: Effect.ALLOW,
              resources: ["*"]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["athena:*"], // TODO: limit actions
              resources: ["*"] // TODO: restrict to the data catalog
            })
          ]
        })
      ],
      environment: {
        REPORT_TABLE: props.dynamoTables["reportTable"].tableName,
        DATA_TABLE: props.dynamoTables["dataSourceTable"].tableName,
        SETTINGS_TABLE: props.dynamoTables["settingsTable"].tableName,
        CATALOG: this.dataCatalog.databaseName,
        BUCKET: this.queryResultBucket.bucketName,
        SUPPRESSION_SERVICE_FUNCTION: this.suppressionServiceFunctionName,
        VIEWER_REPORT_CACHE: viewerReportCache.bucketName!,
        ATHENA_QUERY_RATE: "1000"
      },
      nodeModules: ["web-push"]
    });

    const reportPublishJobStatusHandler = new AdaptNodeLambda(this, "ReportPublishJobStatusHandler", {
      prefix: props.stage,
      handler: "handler",
      timeout: cdk.Duration.seconds(60),
      entry: path.join(__dirname, ".", "./handlers/reportPublishJobStatus/reportPublishJobStatus.ts"),
      attachPolicies: [
        new Policy(this, "reportPublishJobStatus", {
          statements: [
            this.loggingStatement,
            new PolicyStatement({
              actions: ["glue:GetJobRun"],
              effect: Effect.ALLOW,
              resources: ["*"]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["translate:TranslateText"],
              resources: ["*"]
            }),
            new PolicyStatement({
              actions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"],
              effect: Effect.ALLOW,
              resources: [props.dynamoTables["reportTable"].tableArn]
            }),
            new PolicyStatement({
              actions: ["dynamodb:Query"],
              effect: Effect.ALLOW,
              resources: [props.dynamoTables["templatesTable"].tableArn]
            }),
            new PolicyStatement({
              actions: ["dynamodb:GetItem"],
              effect: Effect.ALLOW,
              resources: [props.dynamoTables["pushNotificationsTable"].tableArn, props.dynamoTables["settingsTable"].tableArn]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["lambda:InvokeFunction"], // TODO: limit actions
              resources: [this.renderTemplateServiceFunction.functionArn]
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:*", "s3express:*"], // TODO: restrict
              resources: [viewerReportCache.attrArn, `${viewerReportCache.attrArn}/*`]
            })
          ]
        })
      ],
      environment: {
        TABLE_NAME: props.dynamoTables["reportTable"].tableName,
        NOTIFICATION_TABLE_NAME: props.dynamoTables["pushNotificationsTable"].tableName,
        LOG_GROUP: props.logGroup.logGroupName,
        PUBLIC_VAPID_KEY: props.vapidKeys.publicKey,
        RENDER_TEMPLATE_FUNCTION: this.renderTemplateServiceFunction.functionName,
        PRIVATE_VAPID_KEY: props.vapidKeys.privateKey,
        SETTINGS_TABLE_NAME: props.dynamoTables["settingsTable"].tableName,
        TEMPLATE_TABLE: props.dynamoTables["templatesTable"].tableName,
        VIEWER_REPORT_CACHE: viewerReportCache.bucketName!
      },
      nodeModules: ["web-push"]
    });
    publishReportJobStateChangeRule.addTarget(new LambdaFunction(reportPublishJobStatusHandler));
  }
}
