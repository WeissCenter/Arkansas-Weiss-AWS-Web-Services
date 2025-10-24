import { IAMClient, ListRolePoliciesCommand, GetRolePolicyCommand } from "@aws-sdk/client-iam";
import { AuthorizerAPIGatewayLambda } from "../../../function-interfaces/api-gateway";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { JwtExpiredError } from "aws-jwt-verify/error";
import { APIGatewayAuthorizerResult } from "aws-lambda";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { aws_generateDailyLogStreamID, aws_LogEvent, EventType } from "../../../libs/types/src";

const USER_POOL_ID = process.env.USER_POOL_ID || "";
const CLIENT_ID = process.env.CLIENT_ID || "";
const LOG_GROUP = process.env.LOG_GROUP || "";

const iam_client = new IAMClient();

// TODO: determine cache behavior https://github.com/awslabs/aws-jwt-verify?tab=readme-ov-file#the-jwks-cache
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: "id",
  clientId: CLIENT_ID
  // groups: ["Admin", "Manager", "Editor", "Reader"] // TODO: determine if we want to check groups as well
});

const ERROR_TYPES = ["Unauthorized", "TokenNotFound", "TokenInvalid", "JWTExpired"] as const;
type ErrorType = (typeof ERROR_TYPES)[number];

const INVALID_TOKEN_RESPONSE: APIGatewayAuthorizerResult = {
  principalId: "user",
  policyDocument: {
    Version: "2012-10-17",
    Statement: [
      {
        Action: "execute-api:Invoke",
        Effect: "Deny",
        Resource: "*"
      }
    ]
  }
};

async function verifyToken(verifier, token: string) {
  try {
    const payload = await verifier.verify(token);
    return payload;
  } catch (err) {
    let error: ErrorType;
    if (err instanceof JwtExpiredError) {
      error = "JWTExpired";
    } else {
      error = "TokenInvalid";
    }
    throw new Error(error);
  }
}

async function getPolicyDocumentStatementForRole(iam_client, role: string) {
  const response: any[] = [];
  const roleName = role.split("/")[1];
  const listRolePoliciesResponse = await iam_client.send(new ListRolePoliciesCommand({ RoleName: roleName }));
  for (const policy of listRolePoliciesResponse["PolicyNames"]) {
    const getPolicyResponse = await iam_client.send(new GetRolePolicyCommand({ RoleName: roleName, PolicyName: policy }));
    const policyDocumentStatements = JSON.parse(decodeURIComponent(getPolicyResponse.PolicyDocument))["Statement"];
    for (const statement of policyDocumentStatements) {
      if ("Effect" in statement && statement["Effect"] === "Allow") {
        if ("Action" in statement && (statement["Action"] === "execute-api:Invoke" || (statement["Action"] instanceof Array && statement["Action"].includes("execute-api:Invoke")))) {
          response.push(statement);
        }
      }
    }
  }
  return response;
}

async function authorizer(authToken): Promise<APIGatewayAuthorizerResult> {
  let payload;
  try {
    payload = await verifyToken(verifier, authToken);
    console.log("Payload: ", payload);
  } catch (err) {
    console.error(err);
    return INVALID_TOKEN_RESPONSE;
  }

  const policyDocumentStatements: any[] = [];
  if ("cognito:roles" in payload && payload["cognito:roles"] instanceof Array) {
    for (const role of payload["cognito:roles"]) {
      console.log("Role: ", role);
      const statements = await getPolicyDocumentStatementForRole(iam_client, role);
      console.log("Statements: ", statements);
      policyDocumentStatements.push(...statements);
    }
  }

  const response = {
    principalId: "user",
    policyDocument: {
      Version: "2012-10-17",
      Statement: policyDocumentStatements
    },
    context: {
      username: payload["cognito:username"],
      givenName: payload["given_name"],
      familyName: payload["family_name"],
      email: payload["email"]
    }
  };
  return response;
}

export const handler: AuthorizerAPIGatewayLambda = async (event) => {
  console.log(JSON.stringify(event));

  const authToken = event.headers?.Authorization;
  if (!authToken) {
    console.error("No authorization token found in event");
    return INVALID_TOKEN_RESPONSE;
  }

  const response = await authorizer(authToken);

  // any logging

  const methodArn = event.methodArn;

  if (!(response.policyDocument.Statement[0] as any).Resource.includes(methodArn) && response?.context?.username) {
    const cloudwatch = new CloudWatchLogsClient({ region: "us-east-1" });
    const logStream = aws_generateDailyLogStreamID();
    await aws_LogEvent(cloudwatch, LOG_GROUP, logStream, response.context!.username as string, EventType.CREATE, `User tried to access a resource they were not authorized for`, [
      { label: "method", value: methodArn }
    ]);
  }

  console.debug("Authorizer response: ", JSON.stringify(response));
  return response;
};
