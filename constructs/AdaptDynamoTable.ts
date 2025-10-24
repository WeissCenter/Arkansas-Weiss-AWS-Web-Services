import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";

type PolicyTypes = "READ" | "WRITE";

export class AdaptDynamoTable extends dynamodb.Table {
  policies: { [key in PolicyTypes]: Policy } = {
    READ: {} as Policy,
    WRITE: {} as Policy
  };

  constructor(scope: Construct, id: string, props: dynamodb.TableProps) {
    super(scope, id, {
      // Set overridable defaults
      // End overridable defaults
      ...props,

      // Set non-overridable defaults
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
      // End non-overridable defaults
    });
  }
}
