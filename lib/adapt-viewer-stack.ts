import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptStackProps } from "./adpat-stack-props";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { AdaptRestApi } from "../constructs/AdaptRestApi";
import { AdaptNodeLambda } from "../constructs/AdaptNodeLambda";
import * as path from "path";
import { Policy, PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { AdaptDynamoTable } from "../constructs/AdaptDynamoTable";
import { DataCatalog } from "@aws-sdk/client-athena";
import { AdaptS3Bucket } from "../constructs/AdaptS3Bucket";
import { Database } from "@aws-cdk/aws-glue-alpha";
import * as s3express from "aws-cdk-lib/aws-s3express";
import { Duration } from "aws-cdk-lib";
interface AdaptViewerStackProps extends AdaptStackProps {
  dynamoTables: { [key: string]: AdaptDynamoTable };
  dataCatalog: Database;
  queryResultBucket: AdaptS3Bucket;
  renderTemplateServiceFunction: AdaptNodeLambda;
  reportCache: s3express.CfnDirectoryBucket;
  logGroup: LogGroup;
}

export class AdaptViewerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AdaptViewerStackProps) {
    super(scope, id, props);

    const loggingStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["logs:*"],
      resources: [props.logGroup.logGroupArn]
    });

    const createShareLinkHandler = new AdaptNodeLambda(this, "createShareLinkHandler", {
      prefix: props.stage,
      handler: "handler",
      entry: path.join(__dirname, ".", "./handlers/viewer/createShareLink/createShareLink.ts"),
      attachPolicies: [
        new Policy(this, "createShareLink", {
          statements: [
            loggingStatement,
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
              resources: [props.dynamoTables["shareTable"].tableArn]
            })
          ]
        })
      ],
      environment: {
        TABLE_NAME: props.dynamoTables["shareTable"].tableName,
        LOG_GROUP: props.logGroup.logGroupName
      }
    });

    const restApi = new AdaptRestApi(this, `${props.stage}-AdaptViewerApi`, {
      stage: props.stage,
      apiName: `${props.stage}-AdaptViewerApi`,
      apiStageName: props.stage,
      endpoints: {
        "/settings": {
          GET: {
            handler: new AdaptNodeLambda(this, "getViewerSettingsHandler", {
              prefix: props.stage,
              handler: "handler",
              entry: path.join(__dirname, ".", "./handlers/viewer/getSettings/getSettings.ts"),
              attachPolicies: [
                new Policy(this, "getSettings", {
                  statements: [
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:GetItem"],
                      resources: [props.dynamoTables["settingsTable"].tableArn]
                    })
                  ]
                })
              ],
              environment: {
                SETTINGS_TABLE: props.dynamoTables["settingsTable"].tableName
              }
            })
          }
        },

        "/settings/glossary": {
          GET: {
            handler: new AdaptNodeLambda(this, "viewerGetGlossary", {
              prefix: props.stage,
              handler: "handler",
              environment: {
                SETTINGS_TABLE: props.dynamoTables["settingsTable"].tableName
              },
              entry: path.join(__dirname, ".", "./handlers/viewer/getGlossary/getGlossary.ts"),
              attachPolicies: [
                new Policy(this, "viewerGetGlossaryPolicy", {
                  statements: [
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:GetItem"],
                      resources: [props.dynamoTables["settingsTable"].tableArn]
                    })
                  ]
                })
              ]
            })
          }
        },
        "/reports": {
          GET: {
            handler: new AdaptNodeLambda(this, "viewerGetReports", {
              prefix: props.stage,
              handler: "handler",
              environment: {
                REPORT_TABLE: props.dynamoTables["reportTable"].tableName
              },
              entry: path.join(__dirname, ".", "./handlers/viewer/getReports/getReports.ts"),
              attachPolicies: [
                new Policy(this, "viewerGetReportsPolicy", {
                  statements: [
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:Query", "dynamodb:Scan"],
                      resources: [props.dynamoTables["reportTable"].tableArn]
                    })
                  ]
                })
              ]
            }),
            //cache: { enabled: true, ttl: Duration.minutes(5) }
          }
        },
        "/reports/{slug}": {
          GET: {
            handler: new AdaptNodeLambda(this, "viewerGetReportBySlug", {
              prefix: props.stage,
              handler: "handler",
              environment: {
                REPORT_TABLE: props.dynamoTables["reportTable"].tableName
              },
              entry: path.join(__dirname, ".", "./handlers/viewer/getReports/getReports.ts"),
              attachPolicies: [
                new Policy(this, "viewerGetReportBySlugPolicy", {
                  statements: [
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:Query"],
                      resources: [props.dynamoTables["reportTable"].tableArn, `${props.dynamoTables["reportTable"].tableArn}/index/report-slug-query`]
                    })
                  ]
                })
              ]
            })
          }
        },
        "/reports/share": {
          POST: { handler: createShareLinkHandler }
        },
        "/reports/share/{slug}": {
          GET: { handler: createShareLinkHandler }
        },
        "/reports/{slug}/data": {
          POST: {
            handler: new AdaptNodeLambda(this, "viewerGetDataForReportBySlug", {
              prefix: props.stage,
              handler: "handler",
              timeout: cdk.Duration.seconds(90),
              environment: {
                TABLE_NAME: props.dynamoTables["reportTable"].tableName,
                DATA_TABLE: props.dynamoTables["dataSourceTable"].tableName,
                BUCKET: props.queryResultBucket.bucketName,
                CACHE_BUCKET: props.reportCache.bucketName!,
                TEMPLATE_TABLE: props.dynamoTables["templatesTable"].tableName,
                CATALOG: props.dataCatalog.databaseName,
                RENDER_TEMPLATE_FUNCTION: props.renderTemplateServiceFunction.functionName,
                ATHENA_QUERY_RATE: "1000"
              },
              nodeModules: ["kysely"],
              entry: path.join(__dirname, ".", "./handlers/viewer/getData/getData.ts"),
              attachPolicies: [
                new Policy(this, "viewerGetDataForReportBySlugPolicy", {
                  statements: [
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:Query", "dynamodb:PutItem"],
                      resources: [props.dynamoTables["reportTable"].tableArn, props.dynamoTables["templatesTable"].tableArn, `${props.dynamoTables["reportTable"].tableArn}/index/report-slug-query`]
                    }),
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:PutItem"],
                      resources: [props.dynamoTables["reportTable"].tableArn]
                    }),
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["s3:*", "s3express:*"], // TODO: restrict
                      resources: [props.reportCache.attrArn, `${props.reportCache.attrArn}/*`]
                    }),
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["dynamodb:GetItem"],
                      resources: [props.dynamoTables["dataSourceTable"].tableArn]
                    }),
                    new PolicyStatement({
                      effect: Effect.ALLOW,
                      actions: ["lambda:InvokeFunction"],
                      resources: ["*"] // TODO: restrict to suppression service
                    })
                  ]
                })
              ]
            })
          }
        }
      }
    });
  }
}
