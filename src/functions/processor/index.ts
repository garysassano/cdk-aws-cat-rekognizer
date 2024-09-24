import { IdempotencyConfig } from "@aws-lambda-powertools/idempotency";
import { DynamoDBPersistenceLayer } from "@aws-lambda-powertools/idempotency/dynamodb";
import { makeHandlerIdempotent } from "@aws-lambda-powertools/idempotency/middleware";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  RekognitionClient,
  DetectLabelsCommand,
} from "@aws-sdk/client-rekognition";
import middy from "@middy/core";
import eventNormalizer from "@middy/event-normalizer";
import { S3Event } from "aws-lambda";

// Initialize AWS clients
const rekognitionClient = new RekognitionClient();
const ddbClient = new DynamoDBClient();

// Get the DynamoDB table name for idempotency from environment variables
const idempotencyTableName = process.env.IDEMPOTENCY_TABLE_NAME;
if (!idempotencyTableName) {
  throw new Error("IDEMPOTENCY_TABLE_NAME env var is required.");
}

// Set up the persistence layer for idempotency using DynamoDB
const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: idempotencyTableName,
  awsSdkV3Client: ddbClient,
});

// Configure idempotency settings
const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: "Records[0].s3.object.eTag", // Use S3 object ETag as the idempotency key
  throwOnNoIdempotencyKey: true, // Throw an error if no idempotency key is found
  expiresAfterSeconds: 0, // This setting won't take effect as there's no TTL attribute set in DynamoDB
});

// Note: The idempotency records will never expire automatically because the DynamoDB table
// doesn't have a TTL attribute configured. You may need to implement a cleanup strategy
// or set up TTL in the table if you want old records to be automatically removed.

// Main Lambda handler function
const lambdaHandler = async (event: S3Event) => {
  // Extract relevant information from the S3 event
  const record = event.Records[0];
  const bucketName = record.s3.bucket.name;
  const objectKey = record.s3.object.key;
  const s3Url = `https://${bucketName}.s3.amazonaws.com/${objectKey}`;

  // Check if the image contains a cat
  const isCat = await imageContainsCat(bucketName, objectKey);

  // Return the S3 URL and whether the image contains a cat
  return { s3Url, isCat };
};

// Function to detect if an image contains a cat using Amazon Rekognition
async function imageContainsCat(
  bucketName: string,
  objectKey: string,
): Promise<boolean> {
  // Send a request to Rekognition to detect labels in the image
  const { Labels } = await rekognitionClient.send(
    new DetectLabelsCommand({
      Image: { S3Object: { Bucket: bucketName, Name: objectKey } },
      MaxLabels: 10, // Limit the number of labels to improve performance
    }),
  );

  // Check if any of the detected labels is "Cat"
  return Labels?.some((label) => label.Name === "Cat") || false;
}

// Export the handler with middleware for idempotency and event normalization
export const handler = middy(lambdaHandler)
  .use(makeHandlerIdempotent({ persistenceStore, config: idempotencyConfig }))
  .use(eventNormalizer());
