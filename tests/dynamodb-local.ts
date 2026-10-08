import { spawn } from "node:child_process";
import { createConnection } from "node:net";

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** Reuse a local server, or start the official DynamoDB Local jar with Java. */
export async function ensureDynamoLocal(): Promise<string> {
  const endpoint = process.env.DYNAMODB_ENDPOINT || "http://127.0.0.1:8000";
  const port = Number(new URL(endpoint).port || 80);
  if (await portOpen(port)) return endpoint;
  const jar = process.env.DYNAMODB_LOCAL_JAR || "/tmp/dynamodb-local/DynamoDBLocal.jar";
  const libraryPath = jar.replace(/DynamoDBLocal\.jar$/, "DynamoDBLocal_lib");
  const child = spawn(
    "java",
    ["-Djava.library.path=" + libraryPath, "-jar", jar, "-inMemory", "-sharedDb", "-port", String(port)],
    { stdio: "ignore", detached: true }
  );
  child.unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await portOpen(port)) return endpoint;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`DynamoDB Local did not start at ${endpoint}`);
}
