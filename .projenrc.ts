import { awscdk, javascript } from "projen";

const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: "2.194.0",
  defaultReleaseBranch: "main",
  depsUpgradeOptions: { workflow: false },
  eslint: true,
  minNodeVersion: "22.15.0",
  name: "cdk-aws-cat-rekognizer",
  packageManager: javascript.NodePackageManager.PNPM,
  pnpmVersion: "10",
  prettier: true,
  projenrcTs: true,

  deps: [
    "@aws-sdk/client-rekognition",
    "@aws-sdk/client-s3",
    "@aws-sdk/client-dynamodb",
    "@aws-sdk/s3-request-presigner",
    "@types/aws-lambda",
    "@aws-lambda-powertools/logger",
    "@aws-lambda-powertools/parser",
    "@aws-lambda-powertools/idempotency",
    "@middy/core",
    "@middy/event-normalizer",
    "zod",
  ],
});

project.synth();
