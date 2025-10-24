import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, DataSource, getDatasourceMetadata } from "../../../libs/types/src";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// Define Environment Variables
const TABLE_NAME = process.env.TABLE_NAME || "";
// AWS SDK Clients
const client = new DynamoDBClient({ region: "us-east-1" });
const db = DynamoDBDocument.from(client);

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    const dataSourceID = event.pathParameters ? event.pathParameters["dataSourceId"] : null;
    if (!dataSourceID) {
      return CreateBackendErrorResponse(400, "Missing dataSourceID in path parameters");
    }
    const queryStringParams = event.queryStringParameters;

    const dataSource = await getDatasourceMetadata(db, TABLE_NAME, dataSourceID);

    if (!dataSource) {
      return CreateBackendErrorResponse(404, `Datasource with id ${dataSourceID} does not exist`);
    }

    if (queryStringParams !== null && "retrieveConnectionInfo" in queryStringParams) {
      const secrets = new SecretsManagerClient({ region: "us-east-1" });
      const newSecretCommand = new GetSecretValueCommand({
        SecretId: dataSource.connectionInfo as string
      });

      const secret = await secrets.send(newSecretCommand);

      if (!secret.SecretString) return CreateBackendErrorResponse(500, "failed to retrieve connection information");

      const connectionInfo = JSON.parse(secret.SecretString);

      delete connectionInfo.password;

      return CreateBackendResponse(200, connectionInfo);
    }

    // if the full query parameter was not passed we will just return the source's metadata
    return CreateBackendResponse(200, cleanFields(dataSource));
  } catch (err) {
    console.error(err);
    return CreateBackendErrorResponse(500, "Failed to retrieve data sources");
  }
};

function cleanFields(dataSource: DataSource) {
  // @ts-ignore
  delete dataSource.connectionInfo;
  return dataSource;
}
