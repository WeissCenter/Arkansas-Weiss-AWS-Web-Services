import { Duration } from "aws-cdk-lib";
import { Policy } from "aws-cdk-lib/aws-iam";
import { Code, Function, FunctionProps, ILayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { execSync } from "child_process";
import { Construct } from "constructs";
import { existsSync } from "fs";
import path from "path";

/**
 * Properties for defining an AdaptPythonLambda.
 *
 * @interface AdaptPythonLambdaProps
 * @extends Omit<FunctionProps, "runtime" | "code">
 *
 * @property {string} prefix - A prefix to be used for naming resources.
 * @property {string} codePath - The file path to the folder that holds the Python code for the Lambda function.
 * @property {Policy[]} [attachPolicies] - Optional policies to attach to the Lambda function.
 */
export interface AdaptPythonLambdaProps extends Omit<FunctionProps, "runtime" | "code"> {
  prefix: string;
  codePath: string;
  layers?: ILayerVersion[];
  attachPolicies?: Policy[];
}

export class AdaptPythonLambda extends Function {
  constructor(scope: Construct, id: string, props: AdaptPythonLambdaProps) {
    const codePath = path.join(__dirname, "../lib/", props.codePath);

    const assetOpts = {
      bundling: {
        image: Runtime.PYTHON_3_10.bundlingImage,
        // command: [
        //   "bash",
        //   "-c",
        //   "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
        // ],
        local: {
          tryBundle(outputDir: string) {
            try {
              execSync("pip3 --version");
            } catch {
              return false;
            }

            const commands = [`cd ${codePath}`, `pip3 install -r requirements.txt -t ${outputDir}`, `cp -a . ${outputDir}`];

            execSync(commands.join(" && "));

            return true;
          }
        }
      }
    };

    super(scope, id, {
      // Set overridable defaults
      memorySize: 256,
      timeout: Duration.seconds(6),
      // End overridable defaults
      ...props,
      // Set non-overridable defaults (these must be last and defined in the omit props list)
      runtime: Runtime.PYTHON_3_10,
      functionName: `${props.prefix}-${id}`,
      code: Code.fromAsset(codePath, existsSync(path.join(codePath, "requirements.txt")) ? assetOpts : undefined)
      // End non-overridable defaults
    });

    if (props.attachPolicies) {
      props.attachPolicies.forEach((policy) => {
        if (this.role) {
          policy.attachToRole(this.role);
        }
      });
    }
  }
}
