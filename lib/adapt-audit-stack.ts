import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptStackProps } from "./adpat-stack-props";
import { AdaptAuditBucket } from "../constructs/AdaptAuditBucket/AdaptAuditBucket";
import { AdaptDynamoTable } from "../constructs/AdaptDynamoTable";

interface AdaptAuditStackProps extends AdaptStackProps {
  dynamoTablesToAudit: AdaptDynamoTable[];
  bucketsToAudit: string[];
}

export class AdaptAuditStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AdaptAuditStackProps) {
    super(scope, id, props);

    const auditBucket = new AdaptAuditBucket(this, "AdaptAuditBucket", {
      stage: props.stage
    });

    props.dynamoTablesToAudit.forEach(table => auditBucket.addDynamodbTableToAudit(table));
    props.bucketsToAudit.forEach(bucket => auditBucket.addS3BucketToAudit(bucket));
  }
}
