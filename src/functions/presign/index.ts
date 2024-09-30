import { Logger } from "@aws-lambda-powertools/logger";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AllTopics,
  AuthClient,
  CredentialProvider,
  DisposableTokenScopes,
  ExpiresIn,
} from "@gomomento/sdk";
import { APIGatewayProxyHandlerV2 } from "aws-lambda";

const logger = new Logger({ serviceName: "presignLambda" });
const s3Client = new S3Client();
const bucketName = process.env.REKOGNITION_BUCKET_NAME;
const authClient = new AuthClient({
  credentialProvider:
    CredentialProvider.fromEnvironmentVariable("MOMENTO_API_KEY"),
});

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  logger.info("Received event", { event });

  const body = JSON.parse(event.body ?? "{}");
  const filename = body?.filename ?? "unknown";

  // Generate S3 presigned URL
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: filename,
    ChecksumAlgorithm: "SHA256",
  });

  const url = await getSignedUrl(s3Client, command, {
    expiresIn: 30 * 60,
  });

  logger.info("Generated S3 presigned URL", { filename, url });

  // Generate Momento disposable token
  const tokenResponse = await authClient.generateDisposableToken(
    DisposableTokenScopes.topicPublishSubscribe("rekognition-cache", AllTopics),
    ExpiresIn.minutes(30),
  );

  switch (tokenResponse.type) {
    case "Success":
      logger.info("Generated Momento disposable token", {
        apiKeyPrefix: tokenResponse.authToken.substring(0, 10),
        expiresAt: tokenResponse.expiresAt.epoch(),
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Processed file: ${filename}`,
          uploadUrl: url,
          momentoToken: tokenResponse.authToken,
          tokenExpiresAt: tokenResponse.expiresAt.epoch(),
        }),
      };

    case "Error":
      logger.error("Error generating Momento disposable token", {
        errorCode: tokenResponse.errorCode(),
        errorMessage: tokenResponse.toString(),
      });

      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Error generating Momento token",
          error: tokenResponse.errorCode(),
        }),
      };

    default:
      logger.error("Unexpected token response type");
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: "Unexpected error",
        }),
      };
  }
};
