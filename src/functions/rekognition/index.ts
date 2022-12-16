import { IdempotencyConfig } from "@aws-lambda-powertools/idempotency";
import { DynamoDBPersistenceLayer } from "@aws-lambda-powertools/idempotency/dynamodb";
import { makeHandlerIdempotent } from "@aws-lambda-powertools/idempotency/middleware";
import { Logger } from "@aws-lambda-powertools/logger";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  RekognitionClient,
  DetectLabelsCommand,
} from "@aws-sdk/client-rekognition";
import middy from "@middy/core";
import eventNormalizer from "@middy/event-normalizer";
import { Duration } from "aws-cdk-lib";
import { S3Event } from "aws-lambda";
import { validateEnv } from "../../utils/validate-env";

//==============================================================================
// LAMBDA INITIALIZATION (COLD START)
//==============================================================================

const env = validateEnv(["IDEMPOTENCY_TABLE_NAME"]);

// Initialize Powertools and AWS SDK clients
const logger = new Logger({ serviceName: "rekognitionLambda" });
const rekognitionClient = new RekognitionClient();
const ddbClient = new DynamoDBClient();

// Retrieve the idempotency table name from environment variables
const idempotencyTableName = env.IDEMPOTENCY_TABLE_NAME;

// Set up the persistence layer for idempotency using DynamoDB
const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: idempotencyTableName,
  awsSdkV3Client: ddbClient,
});

// Configure idempotency settings
const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: "Records[0].s3.object.eTag",
  throwOnNoIdempotencyKey: true,
  expiresAfterSeconds: Duration.days(365 * 100).toSeconds(),
});

//==============================================================================
// LAMBDA HANDLER
//==============================================================================

const lambdaHandler = async (event: S3Event) => {
  const record = event.Records[0];
  const bucketName = record.s3.bucket.name;
  const objectKey = record.s3.object.key;
  const s3Url = `https://${bucketName}.s3.amazonaws.com/${objectKey}`;

  const isCat = await imageContainsCat(bucketName, objectKey);

  // This response will be stored in the `data` attribute of the idempotency table
  return { s3Url, isCat };
};

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, { logEvent: true }))
  .use(makeHandlerIdempotent({ persistenceStore, config: idempotencyConfig }))
  .use(eventNormalizer());

//==============================================================================
// HELPER FUNCTIONS
//==============================================================================

/**
 * Detects if an image contains a cat using Amazon Rekognition.
 *
 * @param bucketName - The name of the S3 bucket containing the image.
 * @param objectKey - The key of the image object in the S3 bucket.
 * @returns `true` if a cat is detected, `false` otherwise.
 */
async function imageContainsCat(
  bucketName: string,
  objectKey: string,
): Promise<boolean> {
  const { Labels } = await rekognitionClient.send(
    new DetectLabelsCommand({
      Image: { S3Object: { Bucket: bucketName, Name: objectKey } },
      MaxLabels: 10,
    }),
  );
  return Labels?.some((label) => label.Name?.toLowerCase() === "cat") ?? false;
}
