import { AuthorizationType, Cors, LambdaIntegration, MethodDeploymentOptions, RequestAuthorizer, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AdaptNodeLambda } from "./AdaptNodeLambda";
import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";

type PathPart = string;
type Method = "GET" | "POST" | "PUT" | "DELETE";

interface AdaptMethodCache {
  enabled?: boolean;
  ttl?: Duration;
}
type AdaptApiMethod =
  | AdaptNodeLambda
  | {
      handler: AdaptNodeLambda;
      cache?: AdaptMethodCache;
      // add any other per-method options later (e.g. required params)
    };

type AdaptApiEndpoint = {
  [key in Method]?: AdaptApiMethod;
};

type AdaptApiEndpoints = {
  [key: PathPart]: AdaptApiEndpoint;
};

interface AdaptRestApiProps {
  stage: string;
  cognitoUserPool?: {
    id: string;
    clientId: string;
  };
  apiName: string;
  apiStageName: string;
  authorizer?: RequestAuthorizer;
  endpoints: AdaptApiEndpoints;
  defaultCorsPreflightOptions?: {
    allowOrigins: string[];
    allowMethods: string[];
  };
}

export class AdaptRestApi extends Construct {
  api: RestApi;
  stageName: string;
  _endpoints: AdaptApiEndpoints;

  constructor(scope: Construct, id: string, props: AdaptRestApiProps) {
    super(scope, id);

    this.stageName = props.apiStageName;
    this._endpoints = props.endpoints;

    const HTTP_METHODS: Method[] = ["GET", "POST", "PUT", "DELETE"];
    const methodOptionsMap: { [key: string]: MethodDeploymentOptions } = {};

    const methodOptionsKey = (path: string, verb: Method) => {
      const clean = path?.trim() ?? "";
      if (clean === "" || clean === "/") return `/${verb}`;
      const normalized = clean.startsWith("/") ? clean : `/${clean}`;
      return `${normalized}/${verb}`;
    };

    for (const [path, endpoint] of Object.entries(props.endpoints)) {
      for (const verb of HTTP_METHODS) {
        const spec = endpoint[verb];
        if (!spec) continue;
        if (!this.isConfiguredMethod(spec)) continue;
        const cache = spec.cache;
        if (cache?.enabled) {
          methodOptionsMap[methodOptionsKey(path, verb)] = {
            cachingEnabled: true,
            cacheTtl: cache.ttl ?? Duration.seconds(300)
          };
        }
      }
    }

    const restAPIParams = {
      restApiName: props.apiName,
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS
      },
      defaultMethodOptions: {
        authorizationType: AuthorizationType.NONE
      },
      deployOptions: {
        stageName: props.apiStageName,
        methodOptions: methodOptionsMap
      }
    };

    if (props["defaultCorsPreflightOptions"]) {
      restAPIParams.defaultCorsPreflightOptions = props.defaultCorsPreflightOptions;
    }

    if (props["authorizer"]) {
      restAPIParams["defaultMethodOptions"] = {
        authorizationType: AuthorizationType.CUSTOM,
        authorizer: props.authorizer
      } as any;
    }

    const adaptApi = new RestApi(this, "AdaptApi", restAPIParams);

    for (const [path, endpoint] of Object.entries(props.endpoints)) {
      const resource = adaptApi.root.resourceForPath(path);
      for (const method in endpoint) {
        const lambdaFunction = this.getLambdaFunctionForPath(path, method as Method)!;
        resource.addMethod(method, new LambdaIntegration(lambdaFunction), lambdaFunction.bypassAuthorizer ? { authorizationType: AuthorizationType.NONE } : {});
      }
    }

    this.api = adaptApi;
  }

  isConfiguredMethod(x: AdaptApiMethod): x is { handler: AdaptNodeLambda; cache?: AdaptMethodCache } {
    return typeof x === "object" && x !== null && "handler" in x;
  }

  getLambdaFunctionForPath(path: string, method: Method): AdaptNodeLambda | undefined {
    const spec = this._endpoints[path]?.[method];
    if (!spec) return undefined;
    return this.isConfiguredMethod(spec) ? spec.handler : spec;
  }

  getAllPathAndMethodCombinations(): [string, Method][] {
    const result: [string, Method][] = [];
    for (const [path, endpoint] of Object.entries(this._endpoints)) {
      for (const method in endpoint) {
        result.push([path, method as Method]);
      }
    }
    return result;
  }

  getArnForExecuteApi(path: string, method: Method): string {
    return this.api.arnForExecuteApi(method, path, this.stageName);
  }

  getAllArnsForExecuteApi(): string[] {
    const result: string[] = [];
    for (const [path, method] of this.getAllPathAndMethodCombinations()) {
      result.push(this.getArnForExecuteApi(path, method));
    }
    return result;
  }
}
