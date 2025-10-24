import { APIGatewayAuthorizerResult, APIGatewayEventRequestContext, APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayRequestAuthorizerEvent } from "aws-lambda";

export interface APIGatewayLambda<Event, Result> {
  (event: Event, context: APIGatewayEventRequestContext): Promise<Result>;
}

export type ProxyAPIGatewayLambda = APIGatewayLambda<APIGatewayProxyEvent, APIGatewayProxyResult>;

export type AuthorizerAPIGatewayLambda = APIGatewayLambda<APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult>;

export type SuccessStatusCode = 200 | 201 | 202 | 204;
export type ErrorStatusCode = 400 | 401 | 403 | 404 | 500;

const API_GATEWAY_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, PATCH, DELETE",
  "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization"
};

export const APIGatewayResponse = <T>(statusCode: number, body: T): APIGatewayProxyResult => {
  if (statusCode >= 200 && statusCode < 300) {
    return {
      statusCode: statusCode,
      body: JSON.stringify({ data: body, success: true }),
      headers: API_GATEWAY_HEADERS
    };
  }

  return {
    statusCode: statusCode,
    body: JSON.stringify({ err: body, success: false }),
    headers: API_GATEWAY_HEADERS
  };
};

export const ProxyErrorResponse = <T>(err: T, statusCode: ErrorStatusCode = 500): APIGatewayProxyResult => {
  return APIGatewayResponse(statusCode, err);
};

export const ProxySuccessResponse = <T>(body: T, statusCode: SuccessStatusCode = 200): APIGatewayProxyResult => {
  return APIGatewayResponse(statusCode, body);
};
