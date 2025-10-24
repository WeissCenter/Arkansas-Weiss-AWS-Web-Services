#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AdaptStack } from "../lib/adapt-stack";
import { AdaptDynamoStack } from "../lib/adapt-dynamo-stack";
import { AdaptDataStack } from "../lib/adapt-data-stack";
import { AdaptLoggingStack } from "../lib/adapt-logging-stack";
import { AdaptCognitoStack } from "../lib/adapt-cognito-stack";
import { AdaptUserPermissionStack } from "../lib/adapt-user-permission-stack";
import { AdaptStaticSite } from "../lib/adapt-static-site-stack";
import { AdaptViewerStack } from "../lib/adapt-viewer-stack";
import { AdaptViewerSite } from "../lib/adapt-viewer-site-stack";

const AWS_RESOURCE_UNIQUE_ID = process.env["AWS_RESOURCE_UNIQUE_ID"] || "weiss-default"; // default to weiss-default
const HOSTED_ZONE = process.env["HOSTED_ZONE"] || "adaptdata.org"; // default to adaptdata.org
const HOSTED_ZONE_CERT_ARN = process.env["HOSTED_ZONE_CERT_ARN"] || "";
const VIEWER_SUB_DOMAIN = process.env["VIEWER_SUB_DOMAIN"] || `${AWS_RESOURCE_UNIQUE_ID}-viewer`;
const ADMIN_SUB_DOMAIN = process.env["ADMIN_SUB_DOMAIN"] || `${AWS_RESOURCE_UNIQUE_ID}-admin`; // default to uat-admin
const DOMAIN_PREFIX = process.env["DOMAIN_PREFIX"] || `${AWS_RESOURCE_UNIQUE_ID}-AdaptAdmin`;

const CALLBACK_URL = process.env["CALLBACK_URL"] || `https://${ADMIN_SUB_DOMAIN}.${HOSTED_ZONE}/auth/redirect`;

console.log("CALLBACK_URL: ", CALLBACK_URL, ", HOSTED_ZONE: ", HOSTED_ZONE, ", ADMIN_SUB_DOMAIN: ", ADMIN_SUB_DOMAIN, ", AWS_DEFAULT_REGION: ", process.env["AWS_DEFAULT_REGION"]);

const PUBLIC_VAPID_KEY = process.env["PUBLIC_VAPID_KEY"] || "";
const PRIVATE_VAPID_KEY = process.env["PRIVATE_VAPID_KEY"] || "";

const AWS_ACCOUNT = process.env["AWS_ACCOUNT"] || "";
const AWS_DEFAULT_REGION = process.env["AWS_DEFAULT_REGION"] || "us-east-1";

const app = new cdk.App();

const cognitoStack = new AdaptCognitoStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptCognitoStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  domainPrefix: DOMAIN_PREFIX,
  includeLocalCallbackUrl: AWS_RESOURCE_UNIQUE_ID === "dev", // adds localhost:4200 for CORS access to local development
  callbackUrls: [CALLBACK_URL]
});

const loggingStack = new AdaptLoggingStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptLoggingStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID
});

const dynamoStack = new AdaptDynamoStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptDynamoStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID
});

const dataStack = new AdaptDataStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptDataStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  dynamoTables: dynamoStack.tables,
  vapidKeys: {
    publicKey: PUBLIC_VAPID_KEY,
    privateKey: PRIVATE_VAPID_KEY
  },
  logGroup: loggingStack.logGroup
});

// stack for adapt backend resources
const apiStack = new AdaptStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  dynamoTables: dynamoStack.tables,
  cognito: {
    userPoolId: cognitoStack.userPoolId,
    clientId: cognitoStack.clientId
  },
  stagingBucket: dataStack.stagingBucket,
  repoBucket: dataStack.repoBucket,
  dataSourceGlueRole: dataStack.dataSourceGlueRole,
  queryResultBucket: dataStack.queryResultBucket,
  renderTemplateServiceFunction: dataStack.renderTemplateServiceFunction,
  dataCatalog: dataStack.dataCatalog,
  publishGlueJob: dataStack.publishJob,
  crawlerRole: dataStack.dataSourceGlueRole,
  glueJob: dataStack.dataPullJob,
  suppressionServiceFunction: dataStack.suppressionServiceFunctionName,
  logGroup: loggingStack.logGroup,
  adminReportCache: dataStack.adminReportCache,
  viewerReportCache: dataStack.viewerReportCache
});

const userPermissionStack = new AdaptUserPermissionStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptUserPermissionStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  userPoolId: cognitoStack.userPoolId,
  restApi: apiStack.restApi
});

const adaptViewerStack = new AdaptViewerStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptViewerStack`, {
  dynamoTables: dynamoStack.tables,
  stage: AWS_RESOURCE_UNIQUE_ID,
  logGroup: loggingStack.logGroup,
  dataCatalog: dataStack.dataCatalog,
  queryResultBucket: dataStack.queryResultBucket,
  renderTemplateServiceFunction: dataStack.renderTemplateServiceFunction,
  reportCache: dataStack.viewerReportCache
});

const adminSite = new AdaptStaticSite(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptStaticSiteStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID
});

const viewerSite = new AdaptViewerSite(app, `${AWS_RESOURCE_UNIQUE_ID}-ViewerSiteStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  hostedZone: HOSTED_ZONE,
  subDomain: VIEWER_SUB_DOMAIN,
  certificateArn: HOSTED_ZONE_CERT_ARN,
  env: { account: AWS_ACCOUNT, region: AWS_DEFAULT_REGION }
});
