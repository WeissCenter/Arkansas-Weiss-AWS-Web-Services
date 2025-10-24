import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptStackProps } from "./adpat-stack-props";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export class AdaptLoggingStack extends cdk.Stack {
  logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: AdaptStackProps) {
    super(scope, id, props);

    const adaptLogging = new LogGroup(this, "AdaptLogging", {
      logGroupName: `${props.stage}-AdaptLoggingGroup`, // TODO: rename this to AdaptLogging once AWS naming conflicts are resolved
      retention: RetentionDays.INFINITE
    });
    this.logGroup = adaptLogging;
  }
}
