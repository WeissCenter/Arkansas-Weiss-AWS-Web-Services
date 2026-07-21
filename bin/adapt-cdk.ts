#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AdaptStack } from "../lib/adapt-stack";
import { AdaptDynamoStack } from "../lib/adapt-dynamo-stack";
import { AdaptDataStack } from "../lib/adapt-data-stack";
import { AdaptNetworkStack } from "../lib/adapt-network-stack";
import { AdaptClientVpn } from "../constructs/AdaptClientVpn";
import { AdaptLoggingStack } from "../lib/adapt-logging-stack";
import { AdaptAuditStack } from "../lib/adapt-audit-stack";
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

const DEPLOYMENT_BUILD_RELEASE_NO = process.env["DEPLOYMENT_BUILD_RELEASE_NO"] || "unknown";

// Client DB connectivity (Glue Data VPC + per-client Site-to-Site VPN) is opt-in:
// it provisions a VPC, VGW, and interface endpoints that cost money, so only
// environments that integrate with external client databases should enable it.
const ENABLE_CLIENT_DB_VPN = process.env["ENABLE_CLIENT_DB_VPN"] === "true";
// CIDR for the Glue Data VPC. MUST NOT overlap any client's hub/spoke CIDR.
const GLUE_VPC_CIDR = process.env["GLUE_VPC_CIDR"] || "10.100.0.0/16";

// Per-client static Site-to-Site VPN config (one VPN per entry), as a JSON array in
// the CLIENT_VPNS env var. Cloud/on-prem agnostic — only peerIp (client's VPN device
// IP) and the routed cidrs differ; asn omitted = static routing. Inert when empty.
//   CLIENT_VPNS='[{"name":"acme","peerIp":"203.0.113.4","cidrs":["10.50.0.0/24"],"asn":65000}]'
interface ClientVpnConfig {
  name: string;
  peerIp: string;
  cidrs: string[];
  asn?: number;
}
let CLIENT_VPNS: ClientVpnConfig[] = [];
try {
  CLIENT_VPNS = JSON.parse(process.env["CLIENT_VPNS"] || "[]");
} catch (err) {
  throw new Error(`CLIENT_VPNS must be a valid JSON array of {name, peerIp, cidrs[], asn?}: ${err}`);
}

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

const networkStack = ENABLE_CLIENT_DB_VPN
  ? new AdaptNetworkStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptNetworkStack`, {
      stage: AWS_RESOURCE_UNIQUE_ID,
      glueVpcCidr: GLUE_VPC_CIDR
    })
  : undefined;

// Per-client Site-to-Site VPNs attach to the Glue Data VPC's VGW — one per
// CLIENT_VPNS entry, regardless of whether the client is in AWS, Azure, or on-prem.
if (networkStack) {
  for (const client of CLIENT_VPNS) {
    if (!client?.name || !client?.peerIp || !client?.cidrs?.length) {
      throw new Error(`Invalid CLIENT_VPNS entry (need name, peerIp, cidrs[]): ${JSON.stringify(client)}`);
    }
    new AdaptClientVpn(networkStack, `${client.name}-ClientVpn`, {
      vpc: networkStack.vpc,
      clientName: client.name,
      peerIp: client.peerIp,
      clientCidrs: client.cidrs,
      asn: client.asn
    });
  }
}

const dataStack = new AdaptDataStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptDataStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  dynamoTables: dynamoStack.tables,
  vapidKeys: {
    publicKey: PUBLIC_VAPID_KEY,
    privateKey: PRIVATE_VAPID_KEY
  },
  logGroup: loggingStack.logGroup,
  // Placement networking for the data-pull Glue job (in-VPC execution over the VPN).
  glueVpc: networkStack?.vpc,
  glueSubnet: networkStack?.glueSubnet,
  glueSecurityGroup: networkStack?.glueSecurityGroup
});

new AdaptAuditStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptAuditStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  dynamoTablesToAudit: [dynamoStack.tables.dataSourceTable, dynamoStack.tables.reportTable],
  bucketsToAudit: [dataStack.stagingBucketName]
});

// stack for adapt backend resources
const apiStack = new AdaptStack(app, `${AWS_RESOURCE_UNIQUE_ID}-AdaptStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  hostedZone: HOSTED_ZONE,
  subDomain: ADMIN_SUB_DOMAIN,
  version: DEPLOYMENT_BUILD_RELEASE_NO,
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
  viewerReportCache: dataStack.viewerReportCache,
  glueVpc: networkStack?.vpc,
  glueSubnet: networkStack?.glueSubnet,
  glueSecurityGroup: networkStack?.glueSecurityGroup
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
  stage: AWS_RESOURCE_UNIQUE_ID,
  hostedZone: HOSTED_ZONE,
  subDomain: ADMIN_SUB_DOMAIN,
  certificateArn: HOSTED_ZONE_CERT_ARN,
});

const viewerSite = new AdaptViewerSite(app, `${AWS_RESOURCE_UNIQUE_ID}-ViewerSiteStack`, {
  stage: AWS_RESOURCE_UNIQUE_ID,
  hostedZone: HOSTED_ZONE,
  subDomain: VIEWER_SUB_DOMAIN,
  certificateArn: HOSTED_ZONE_CERT_ARN,
  env: { account: AWS_ACCOUNT, region: AWS_DEFAULT_REGION }
});
