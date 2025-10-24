import { Duration } from "aws-cdk-lib";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Policy } from "aws-cdk-lib/aws-iam";
import { Charset, OutputFormat, SourceMapMode } from "aws-cdk-lib/aws-lambda-nodejs";

export interface AdaptNodeLambdaProps extends nodejs.NodejsFunctionProps {
  // Define construct properties here
  prefix: string;
  attachPolicies?: Policy[];
  nodeModules?: string[];
  bypassAuthorizer?: boolean;
}

export class AdaptNodeLambda extends nodejs.NodejsFunction {
  public bypassAuthorizer?: boolean;

  constructor(scope: Construct, id: string, props: AdaptNodeLambdaProps) {
    super(scope, id, {
      // Set overridable defaults
      memorySize: 512,
      timeout: Duration.seconds(3),
      // End overridable defaults
      ...props,
      // Set non-overridable defaults (these must be last and defined in the omit props list)
      runtime: Runtime.NODEJS_20_X,
      functionName: `${props.prefix}-${id}`, // The function name cannot be more than 64 characters
      bundling: {
        charset: Charset.UTF8,
        format: OutputFormat.CJS,
        sourceMap: true, // include source map, defaults to false
        sourceMapMode: SourceMapMode.INLINE, // defaults to SourceMapMode.DEFAULT
        sourcesContent: false, // do not include original source into source map, defaults to true
        target: "esnext", // target environment for the generated JavaScript code
        // tsconfig: resolve(__dirname, '../tsconfig.json'), // TODO: determine if this is correct
        nodeModules: props.nodeModules || undefined,
        esbuildArgs: {
          "--loader:.node": "file"
        }
      }
      // End non-overridable defaults
    });

    if (props.attachPolicies) {
      props.attachPolicies.forEach((policy) => {
        if (this.role) {
          policy.attachToRole(this.role);
        }
      });
    }

    this.bypassAuthorizer = props.bypassAuthorizer;
  }
}
