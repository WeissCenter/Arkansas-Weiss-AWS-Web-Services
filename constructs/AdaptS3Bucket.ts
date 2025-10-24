import { RemovalPolicy } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
export class AdaptS3Bucket extends s3.Bucket {
  constructor(scope: Construct, id: string, props?: s3.BucketProps) {
    super(scope, id, {
      // Set overridable defaults
      // End overridable defaults
      ...props,
      // Set non-overridable defaults
      bucketName: props?.bucketName?.toLowerCase() || undefined, // FIXME: add account number to end of bucket?!?
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE // TODO: determine the "adapt" specific properties
      // End non-overridable defaults
    });
  }
}
