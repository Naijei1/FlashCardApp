// Idempotently copy the legacy single-user table into multi-user keys.
// Refuses the production table name `flashcards` and refuses real AWS unless
// the corresponding break-glass environment variables are set deliberately.
// Existing items are never deleted or overwritten.
//
// Usage:
//   DYNAMODB_ENDPOINT=http://127.0.0.1:8000 TABLE_NAME=flashcards-copy \
//     npx tsx scripts/migrate-multi-user.ts --config migration-config.json
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { migrateMultiUser, type MigrationConfig } from "../lib/migration";

loadEnvConfig(process.cwd());

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const configPath = argument("--config");
  if (!configPath) throw new Error("--config path is required");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as MigrationConfig;
  const report = await migrateMultiUser({
    tableName: process.env.TABLE_NAME || "",
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: process.env.APP_REGION,
    config,
    dryRun: process.argv.includes("--dry-run"),
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
