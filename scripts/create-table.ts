// Creates the DynamoDB table. Usage:
//   npx tsx scripts/create-table.ts            (uses .env.local-style env vars)
// Env: TABLE_NAME, APP_REGION, optional DYNAMODB_ENDPOINT for DynamoDB Local.
import { loadEnvConfig } from "@next/env";
import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";

loadEnvConfig(process.cwd());

async function main() {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: process.env.APP_REGION || "us-east-1",
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  const tableName = process.env.TABLE_NAME || "flashcards-dev";
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    console.log(`Created table ${tableName}`);
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceInUseException") {
      console.log(`Table ${tableName} already exists`);
    } else {
      throw error;
    }
  }
  const tables = await client.send(new ListTablesCommand({}));
  console.log("Tables:", tables.TableNames);
}

main();
