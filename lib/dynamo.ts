import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// On Amplify Hosting the SSR compute role supplies credentials via the default
// chain; locally the ~/.aws profile or DYNAMODB_ENDPOINT (DynamoDB Local) is used.
function createClient(): DynamoDBDocumentClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: process.env.APP_REGION || "us-east-1",
    ...(endpoint
      ? {
          endpoint,
          credentials: { accessKeyId: "local", secretAccessKey: "local" },
        }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

const globalForDb = globalThis as unknown as { __ddb?: DynamoDBDocumentClient };

/** One document client per server instance, shared by cards and auth items. */
export function getDocClient(): DynamoDBDocumentClient {
  return (globalForDb.__ddb ??= createClient());
}

const SLOW_DB_OPERATION_MS = 500;

export async function observeDbLatency<T>(operation: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    const durationMs = Date.now() - startedAt;
    if (durationMs >= SLOW_DB_OPERATION_MS) {
      // Do not include keys, expressions, request bodies, or table names: this
      // diagnostic is intentionally safe to emit to shared hosting logs.
      console.warn("Slow DynamoDB operation", { operation, durationMs });
    }
  }
}

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME is not set");
  return name;
}

/**
 * Card and account stores call `doc.send`. The proxy reads the shared client
 * at call time so tests can replace `globalThis.__ddb` first.
 */
export const doc: DynamoDBDocumentClient = new Proxy({} as DynamoDBDocumentClient, {
  get(_target, prop) {
    const client = getDocClient() as unknown as Record<PropertyKey, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
});
