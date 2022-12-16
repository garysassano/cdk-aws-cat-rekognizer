import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommandOutput,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import {
  RekognitionClient,
  DetectLabelsCommand,
} from "@aws-sdk/client-rekognition";
import { S3Client, GetObjectAttributesCommand } from "@aws-sdk/client-s3";
import middy from "@middy/core";
import eventNormalizer from "@middy/event-normalizer";
import { S3EventRecord, S3Handler } from "aws-lambda";

const rekognitionClient = new RekognitionClient();
const ddbClient = new DynamoDBClient();
const s3Client = new S3Client();
const tableName = process.env.IDEMPOTENCY_TABLE_NAME;

const lambdaHandler: S3Handler = async (event) => {
  await Promise.all(event.Records.map(processRecord));
};

export const handler = middy(lambdaHandler).use(eventNormalizer());

async function processRecord(record: S3EventRecord) {
  const bucketName = record.s3.bucket.name;
  const objectKey = record.s3.object.key;
  const s3Url = `https://${bucketName}.s3.amazonaws.com/${objectKey}`;

  try {
    const objectETag = await getObjectETag(bucketName, objectKey);
    if (!objectETag) {
      console.error("ETag not found for object:", objectKey);
      return;
    }

    const isCat = await getIsCatValue(objectETag, bucketName, objectKey);
    await saveRecordToDb(objectETag, s3Url, isCat);
  } catch (error) {
    console.error(`Error processing record: ${error}`, record);
  }
}

async function getIsCatValue(
  objectETag: string,
  bucketName: string,
  objectKey: string,
): Promise<boolean> {
  // Query DynamoDB to check if the ETag already exists
  const queryResponse = await queryByETag(objectETag);

  if (queryResponse.Items && queryResponse.Items.length > 0) {
    console.log(
      "ETag already exists in DynamoDB, using IsCat value from a previous record",
    );
    // Return the IsCat value from the DynamoDB item
    return queryResponse.Items[0].IsCat.BOOL!;
  } else {
    // If the ETag does not exist, invoke Rekognition
    return imageContainsCat(bucketName, objectKey);
  }
}

async function queryByETag(objectETag: string): Promise<QueryCommandOutput> {
  const queryCommand = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "ObjectETag = :etag",
    ExpressionAttributeValues: {
      ":etag": { S: objectETag },
    },
  });

  return ddbClient.send(queryCommand);
}

async function getObjectETag(
  bucketName: string,
  objectKey: string,
): Promise<string | undefined> {
  const getObjectAttributesCommand = new GetObjectAttributesCommand({
    Bucket: bucketName,
    Key: objectKey,
    ObjectAttributes: ["ETag"],
  });

  const s3Response = await s3Client.send(getObjectAttributesCommand);
  return s3Response.ETag;
}

async function imageContainsCat(
  bucketName: string,
  objectKey: string,
): Promise<boolean> {
  const detectLabelsCommand = new DetectLabelsCommand({
    Image: { S3Object: { Bucket: bucketName, Name: objectKey } },
    MaxLabels: 10,
  });

  const rekognitionResponse = await rekognitionClient.send(detectLabelsCommand);
  return (
    rekognitionResponse.Labels?.some((label) => label.Name === "Cat") || false
  );
}

async function saveRecordToDb(
  objectETag: string,
  s3Url: string,
  isCat: boolean,
): Promise<void> {
  const putItemCommand = new PutItemCommand({
    TableName: tableName,
    Item: {
      ObjectETag: { S: objectETag },
      S3Url: { S: s3Url },
      IsCat: { BOOL: isCat },
    },
  });

  await ddbClient.send(putItemCommand);
  console.log(JSON.stringify({ objectETag, s3Url, isCat }));
}
