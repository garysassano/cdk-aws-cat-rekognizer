import { join } from "path";
import { CloudFrontToS3 } from "@aws-solutions-constructs/aws-cloudfront-s3";
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
import { PriceClass } from "aws-cdk-lib/aws-cloudfront";
import { TableV2, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime, LoggingFormat } from "aws-cdk-lib/aws-lambda";
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

    // CloudFront distribution to serve the website from S3 bucket via OAC
    const cloudfront = new CloudFrontToS3(this, "CloudFrontToS3", {
      existingBucketObj: websiteBucket,
      cloudFrontDistributionProps: {
        priceClass: PriceClass.PRICE_CLASS_100,
        enableLogging: false,
      },
      insertHttpSecurityHeaders: false,
      logS3AccessLogs: false,
    });
    const websiteDistribution = cloudfront.cloudFrontWebDistribution;

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
      entry: join(__dirname, "..", "functions", "processor", "index.ts"),
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(1),
      memorySize: 1024,
      loggingFormat: LoggingFormat.JSON,
      environment: {
        REKOGNITION_TABLE_NAME: rekognitionTable.tableName,
      },
    });

    // Grant permissions to processor Lambda function
    rekognitionBucket.grantRead(processorLambda);
    rekognitionTable.grantReadWriteData(processorLambda);
    processorLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["rekognition:DetectLabels"],
        resources: ["*"],
      }),
    );

    // Trigger Lambda function on object upload to S3
    new S3ToLambda(this, "S3ToLambda", {
      existingBucketObj: rekognitionBucket,
      existingLambdaObj: processorLambda,
    });

    // Lambda function to handle HTTP requests
    const httpLambda = new NodejsFunction(this, "HttpLambda", {
      functionName: `http-lambda-${uniqueId}`,
      entry: join(__dirname, "..", "functions", "http", "index.ts"),
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(1),
      memorySize: 1024,
      loggingFormat: LoggingFormat.JSON,
      environment: {
        REKOGNITION_BUCKET_NAME: rekognitionBucket.bucketName,
        REKOGNITION_TABLE_NAME: rekognitionTable.tableName,
      },
    });

    // Grant permissions to http Lambda function
    rekognitionBucket.grantPut(httpLambda);
    rekognitionTable.grantReadData(httpLambda);

    // Create an HTTP API with CORS enabled
    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: `http-api-${uniqueId}`,
      corsPreflight: {
        allowOrigins: [`https://${websiteDistribution.distributionDomainName}`],
      },
    });

    // Trigger Lambda function on HTTP requests
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
        Source.asset(join(__dirname, "..", "website")),
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
