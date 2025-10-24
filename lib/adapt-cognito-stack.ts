import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AdaptStackProps } from "./adpat-stack-props";
import { UserPool } from "aws-cdk-lib/aws-cognito";

interface AdaptCognitoStackProps extends AdaptStackProps {
  domainPrefix: string;
  includeLocalCallbackUrl: boolean;
  callbackUrls: string[];
}

export class AdaptCognitoStack extends cdk.Stack {
  userPoolId: string;
  clientId: string;

  constructor(scope: Construct, id: string, props: AdaptCognitoStackProps) {
    super(scope, id, props);
    const userPool = new UserPool(this, "AdaptUserPool", {
      userPoolName: `${props.stage}-AdaptUserPool`
    });
    this.userPoolId = userPool.userPoolId;

    // const samlIdentityProvider = new UserPoolIdentityProviderSaml(
    //   this,
    //   "SAMLIdentityProvider",
    //   {
    //     name: `${props.stage}-SAMLIdentityProvider`,
    //     userPool: userPool,
    //     metadata: UserPoolIdentityProviderSamlMetadata.file(""), // TODO: replace with actual metadata
    //     requestSigningAlgorithm: SigningAlgorithm.RSA_SHA256,
    //     idpInitiated: true,
    //   }
    // );

    const localCallbackUrl = props.includeLocalCallbackUrl ? ["http://localhost:4200/auth/redirect"] : [];

    const userPoolClient = userPool.addClient("AdaptUserPoolClient", {
      userPoolClientName: `${props.stage}-AdaptUserPoolClient`,
      authFlows: {
        userPassword: true
      },
      oAuth: {
        callbackUrls: [...localCallbackUrl, ...props.callbackUrls]
      },
      accessTokenValidity: cdk.Duration.hours(8)
    });
    this.clientId = userPoolClient.userPoolClientId;

    userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix: props.domainPrefix.toLowerCase()
      }
    });
  }
}
