import { awscdk, javascript } from "projen";
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: "2.130.0",
  defaultReleaseBranch: "main",
  depsUpgradeOptions: { workflow: false },
  eslint: true,
  minNodeVersion: "20.11.1",
  name: "cdk-aws-cat-rekognizer",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: "8.15.4",
  prettier: true,
  projenrcTs: true,

  deps: [
    "@aws-solutions-constructs/aws-s3-lambda",
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
