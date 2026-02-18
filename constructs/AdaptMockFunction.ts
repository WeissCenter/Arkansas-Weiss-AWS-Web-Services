import { MockIntegration, IntegrationOptions } from "aws-cdk-lib/aws-apigateway";
import { AdaptNodeLambdaProps } from "./AdaptNodeLambda";

export class AdaptMockFunction extends MockIntegration {

  public bypassAuthorizer?: boolean;
  public integrationResponses: any;

  //, props: AdaptNodeLambdaProps
  constructor(options?: IntegrationOptions) {

    console.log("Constructing AdaptMockFunction with options:", options);

    super(options);
    this.integrationResponses = options.integrationResponses;
    this.bypassAuthorizer = true; //props.bypassAuthorizer;

  }
}
