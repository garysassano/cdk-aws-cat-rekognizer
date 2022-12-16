import path from "path";
import { S3ToLambda } from "@aws-solutions-constructs/aws-s3-lambda";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import {
  CfnDistribution,
  CfnOriginAccessControl,
  Distribution,
} from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { TableV2, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime, LogFormat } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, HttpMethods } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // Generate a unique ID for resource naming
    const uniqueId = this.node.addr.substring(0, 8);

    // S3 bucket for hosting the static website
    const websiteBucket = new Bucket(this, "WebsiteBucket", {
      bucketName: `website-bucket-${uniqueId}`,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront distribution to serve the website from S3 bucket
    const websiteDistribution = new Distribution(this, "WebsiteDistribution", {
      defaultBehavior: {
        origin: new S3Origin(websiteBucket),
      },
      defaultRootObject: "index.html",
    });

    // S3 bucket for storing images to be processed by Rekognition
    const rekognitionBucket = new Bucket(this, "RekognitionBucket", {
      bucketName: `rekognition-bucket-${uniqueId}`,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [HttpMethods.PUT],
          allowedHeaders: ["*"],
          allowedOrigins: [
            `https://${websiteDistribution.distributionDomainName}`,
          ],
          maxAge: 3000,
        },
      ],
    });

    // DynamoDB table for storing results of lambda processor
    const rekognitionTable = new TableV2(this, "RekognitionTable", {
      tableName: `rekognition-table-${uniqueId}`,
      partitionKey: { name: "ObjectETag", type: AttributeType.STRING },
      sortKey: { name: "S3Url", type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda function to process images uploaded to the S3 bucket
    const processorLambda = new NodejsFunction(this, `ProcessorLambda`, {
      functionName: `processor-lambda-${uniqueId}`,
      entry: path.join(__dirname, "..", "functions", "processor", "index.ts"),
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      logFormat: LogFormat.JSON,
      memorySize: 1024,
      environment: {
        REKOGNITION_TABLE_NAME: rekognitionTable.tableName,
      },
    });

    // IAM policy to allow Lambda function to read from S3 bucket
    const bucketPolicy = new PolicyStatement({
      actions: ["s3:ListBucket", "s3:GetObject*"],
      resources: [
        rekognitionBucket.bucketArn,
        rekognitionBucket.arnForObjects("*"),
      ],
    });
    // IAM policy to allow Lambda function to call Rekognition service
    const rekognitionPolicy = new PolicyStatement({
      actions: ["rekognition:DetectLabels"],
      resources: ["*"],
    });
    // IAM policy to allow Lambda function to write to the DynamoDB table
    const dynamoDbPolicy = new PolicyStatement({
      actions: ["dynamodb:PutItem", "dynamodb:Query"],
      resources: [rekognitionTable.tableArn],
    });
    // Attach the policies to the Lambda function's execution role
    processorLambda.addToRolePolicy(bucketPolicy);
    processorLambda.addToRolePolicy(rekognitionPolicy);
    processorLambda.addToRolePolicy(dynamoDbPolicy);

    // S3 to Lambda integration: trigger Lambda function on S3 object upload
    new S3ToLambda(this, "S3ToLambda", {
      existingBucketObj: rekognitionBucket,
      existingLambdaObj: processorLambda,
    });

    // Origin Access Control for CloudFront
    const oac = new CfnOriginAccessControl(this, "WebsiteBucketOac", {
      originAccessControlConfig: {
        name: `website-bucket-oac-${uniqueId}`,
        originAccessControlOriginType: "s3",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });

    // Modify CloudFront distribution to integrate OAC
    const cfnDistribution = websiteDistribution.node
      .defaultChild as CfnDistribution;
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity",
      "",
    );
    cfnDistribution.addPropertyOverride(
      "DistributionConfig.Origins.0.OriginAccessControlId",
      oac.attrId,
    );

    // IAM policy to allow CloudFront access to website S3 bucket
    const websiteBucketPolicy = new PolicyStatement({
      principals: [new ServicePrincipal("cloudfront.amazonaws.com")],
      actions: ["s3:GetObject"],
      effect: Effect.ALLOW,
      conditions: {
        StringEquals: {
          "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${websiteDistribution.distributionId}`,
        },
      },
      resources: [websiteBucket.arnForObjects("*")],
    });
    // Attach the policy to the bucket
    websiteBucket.addToResourcePolicy(websiteBucketPolicy);

    // Lambda function to handle HTTP requests
    const httpLambda = new NodejsFunction(this, "HttpLambda", {
      functionName: `http-lambda-${uniqueId}`,
      entry: path.join(__dirname, "..", "functions", "http", "index.ts"),
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(5),
      logFormat: LogFormat.JSON,
      memorySize: 1024,
      environment: {
        REKOGNITION_BUCKET_NAME: rekognitionBucket.bucketName,
        REKOGNITION_TABLE_NAME: rekognitionTable.tableName,
      },
    });

    // IAM policy to allow Lambda function to create PUT presigned URL
    const httpLambdaPolicy = new PolicyStatement({
      actions: ["s3:PutObject*"],
      resources: [rekognitionBucket.arnForObjects("*")],
    });
    // IAM policy to allow Lambda function to write to the DynamoDB table
    const dynamoDbPolicy2 = new PolicyStatement({
      actions: ["dynamodb:GetItem"],
      resources: [rekognitionTable.tableArn],
    });
    // Attach the policies to the Lambda function's execution role
    httpLambda.addToRolePolicy(httpLambdaPolicy);
    httpLambda.addToRolePolicy(dynamoDbPolicy2);

    // Create an HTTP API with CORS enabled
    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: `http-api-${uniqueId}`,
      corsPreflight: {
        allowOrigins: [`https://${websiteDistribution.distributionDomainName}`],
      },
    });

    // Lambda to API Gateway integration: trigger Lambda function on HTTP request
    const httpApiLambdaIntegration = new HttpLambdaIntegration(
      "HttpApiLambdaIntegration",
      httpLambda,
    );

    // Add a route with Lambda integration
    httpApi.addRoutes({
      path: "/upload",
      methods: [HttpMethod.POST],
      integration: httpApiLambdaIntegration,
    });

    // Deploy the static website files to the S3 bucket
    new BucketDeployment(this, "WebsiteBucketDeployment", {
      sources: [
        Source.asset(path.join(__dirname, "..", "website")),
        Source.jsonData("config.json", {
          apiEndpointUrl: httpApi.apiEndpoint,
        }),
      ],
      destinationBucket: websiteBucket,
      distribution: websiteDistribution,
      distributionPaths: ["/index.html"],
    });

    // Output the CloudFront distribution URL
    new CfnOutput(this, "WebsiteDistributionUrl", {
      value: `https://${websiteDistribution.distributionDomainName}`,
    });
  }
}
