import { App } from "aws-cdk-lib";
import { MyStack } from "./stacks/my-stack";

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new MyStack(app, "cdk-aws-cat-rekognizer-dev", { env: devEnv });

app.synth();
