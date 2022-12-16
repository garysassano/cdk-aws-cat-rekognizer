import { join } from "path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Distribution, PriceClass } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { TableV2, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime, LoggingFormat } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, EventType, HttpMethods } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
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
    const websiteDistribution = new Distribution(this, "WebsiteDistribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(websiteBucket),
      },
      defaultRootObject: "index.html",
      priceClass: PriceClass.PRICE_CLASS_100,
    });

    // S3 bucket for storing images to be processed by Rekognition
    const rekognitionBucket = new Bucket(this, "RekognitionBucket", {
      bucketName: `rekognition-bucket-${uniqueId}`,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedOrigins: [
            `https://${websiteDistribution.distributionDomainName}`,
          ],
          allowedMethods: [HttpMethods.PUT],
          allowedHeaders: ["*"],
          maxAge: 300,
        },
      ],
    });

    // DynamoDB table for idempotency
    const idempotencyTable = new TableV2(this, "IdempotencyTable", {
      tableName: `idempotency-table-${uniqueId}`,
      partitionKey: {
        name: "id",
        type: AttributeType.STRING,
      },
      timeToLiveAttribute: "expiration",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Lambda function to process images uploaded to the rekognition bucket
    const rekognitionLambda = new NodejsFunction(this, `RekognitionLambda`, {
      functionName: `rekognition-lambda-${uniqueId}`,
      entry: join(__dirname, "..", "functions", "rekognition", "index.ts"),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(1),
      memorySize: 1024,
      loggingFormat: LoggingFormat.JSON,
      environment: {
        IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
      },
    });

    // Grant permissions to rekognition Lambda function
    idempotencyTable.grantReadWriteData(rekognitionLambda);
    rekognitionBucket.grantRead(rekognitionLambda);
    rekognitionLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["rekognition:DetectLabels"],
        resources: ["*"],
      }),
    );

    // Trigger Lambda function on object upload to S3
    rekognitionBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(rekognitionLambda),
    );

    // Lambda function to generate presigned URLs for S3 uploads
    const presignLambda = new NodejsFunction(this, "PresignLambda", {
      functionName: `presign-lambda-${uniqueId}`,
      entry: join(__dirname, "..", "functions", "presign", "index.ts"),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(1),
      memorySize: 1024,
      loggingFormat: LoggingFormat.JSON,
      environment: {
        REKOGNITION_BUCKET_NAME: rekognitionBucket.bucketName,
      },
    });

    // Grant permissions to presign Lambda function
    rekognitionBucket.grantPut(presignLambda);

    // Create an HTTP API with CORS enabled
    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: `http-api-${uniqueId}`,
      corsPreflight: {
        allowOrigins: [`https://${websiteDistribution.distributionDomainName}`],
        allowMethods: [CorsHttpMethod.POST],
        allowHeaders: ["Content-Type"],
        maxAge: Duration.minutes(5),
      },
    });

    // Trigger Lambda function on HTTP requests
    const httpApiLambdaIntegration = new HttpLambdaIntegration(
      "HttpApiLambdaIntegration",
      presignLambda,
    );

    // Add a route with Lambda integration
    httpApi.addRoutes({
      path: "/presign",
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
