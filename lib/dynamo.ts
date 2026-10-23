import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

function createClient(): DynamoDBDocumentClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: process.env.APP_REGION || "us-east-1",
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

const globalForDb = globalThis as typeof globalThis & { __flashcardsDoc?: DynamoDBDocumentClient };

export const doc = (globalForDb.__flashcardsDoc ??= createClient());

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME is not set");
  return name;
}
