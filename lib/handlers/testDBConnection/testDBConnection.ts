import { APIGatewayEvent, Context, Handler } from "aws-lambda";
import { CreateBackendResponse, CreateBackendErrorResponse, TestDBConnectionInput } from "../../../libs/types/src";
import * as sql from "mssql";

// Define Environment Variables

// AWS SDK Clients

export const handler: Handler = async (event: APIGatewayEvent, context: Context) => {
  console.log(event);
  try {
    if (!event?.body) {
      return CreateBackendErrorResponse(400, "Missing body");
    }

    const body = JSON.parse(event.body) as TestDBConnectionInput;

    switch (body.type) {
      case "mssql": {
        await tryMSSQL(body);
        break;
      }
    }

    return CreateBackendResponse(200);
  } catch (err) {
    console.error(err);
    if (err instanceof sql.ConnectionError) {
      switch (err.code) {
        case "ELOGIN": {
          return CreateBackendErrorResponse(400, "Connection Failed: Login Failed");
        }
        case "ETIMEOUT": {
          return CreateBackendErrorResponse(400, "Connection Failed: Connection Timeout");
        }
        case "ESOCKET": {
          return CreateBackendErrorResponse(400, "Connection Failed: Socket Error");
        }
        case "ECONNCLOSED": {
          return CreateBackendErrorResponse(400, "Connection Failed: Connection was closed");
        }
      }
    }

    return CreateBackendErrorResponse(500, "Failed to test connection to the database");
  }
};

async function tryMSSQL(input: TestDBConnectionInput) {
  const configParams = {
    user: input.username,
    password: input.password,
    database: input.database,
    server: input.url,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    },
    options: {
      trustServerCertificate: true // change to true for local dev / self-signed certs
    }
  };

  const pool = await sql.connect(configParams);

  await pool.close();
}
