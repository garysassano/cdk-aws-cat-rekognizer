import { Logger } from "@aws-lambda-powertools/logger";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { JSONStringified } from "@aws-lambda-powertools/parser/helpers";
import { parser } from "@aws-lambda-powertools/parser/middleware";
import { APIGatewayProxyEventV2Schema } from "@aws-lambda-powertools/parser/schemas";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import middy from "@middy/core";
import { z } from "zod";
import { validateEnv } from "../../utils/validate-env";

//==============================================================================
// LAMBDA INITIALIZATION (COLD START)
//==============================================================================

const env = validateEnv(["REKOGNITION_BUCKET_NAME"]);

// Initialize Powertools and AWS SDK clients
const logger = new Logger({ serviceName: "presignLambda" });
const s3Client = new S3Client();

// Retrieve the rekognition bucket name from environment variables
const rekognitionBucketName = env.REKOGNITION_BUCKET_NAME;

// Define the schema for the presign request and create a type from it
const presignRequestSchema = APIGatewayProxyEventV2Schema.extend({
  body: JSONStringified(
    z.object({
      filename: z.string().min(1).max(255),
    }),
  ),
});
type PresignRequest = z.infer<typeof presignRequestSchema>;

//==============================================================================
// LAMBDA HANDLER
//==============================================================================

const lambdaHandler = async (event: PresignRequest) => {
  const { filename } = event.body;

  const putPresignedUrl = await generatePutPresignedUrl(filename);

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: `Processed file: ${filename}`,
      putPresignedUrl,
    }),
  };
};

export const handler = middy(lambdaHandler)
  .use(injectLambdaContext(logger, { logEvent: true }))
  .use(parser({ schema: presignRequestSchema }));

//==============================================================================
// HELPER FUNCTIONS
//==============================================================================

/**
 * Generates a PUT presigned URL for uploading a file to S3.
 *
 * @param filename - The name of the file to be uploaded.
 * @returns The PUT presigned URL.
 */
async function generatePutPresignedUrl(filename: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: rekognitionBucketName,
    Key: filename,
    ChecksumAlgorithm: "SHA256",
  });
  return getSignedUrl(s3Client, command, { expiresIn: 300 });
}
