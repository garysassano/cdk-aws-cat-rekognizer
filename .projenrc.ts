import { awscdk, javascript } from "projen";

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: "2.156.0",
  defaultReleaseBranch: "main",
  depsUpgradeOptions: { workflow: false },
  eslint: true,
  minNodeVersion: "20.17.0",
  name: "cdk-aws-cat-rekognizer",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: "9.9.0",
  prettier: true,
  projenrcTs: true,

  deps: [
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/client-ssm",
    "@aws-sdk/client-rekognition",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "@types/aws-lambda",
    "@middy/core",
    "@middy/event-normalizer",
  ],
});

project.synth();
