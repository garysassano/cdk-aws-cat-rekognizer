import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyHandlerV2 } from "aws-lambda";

const s3Client = new S3Client();
const bucketName = process.env.REKOGNITION_BUCKET_NAME;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log(`Event: ${JSON.stringify(event)}`);

  const body = JSON.parse(event.body || "{}");
  const filename = body.filename ?? "unknown";

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: filename,
    ChecksumAlgorithm: "SHA256",
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 3600,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Processed file: ${filename}`,
      uploadUrl: url,
    }),
  };
};
