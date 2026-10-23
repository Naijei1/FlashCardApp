/**
 * Copy legacy decks and card progress onto multi-user keys.
 *
 * Dry run is the default. Nothing is written unless you pass --apply and
 * --i-backed-up. The production table name `flashcards` is always refused.
 * Do not point this at production.
 *
 *   npm run migrate:multi-user
 *   npm run migrate:multi-user -- --apply --i-backed-up
 *
 * Reads TABLE_NAME, APP_REGION, DYNAMODB_ENDPOINT, and optional
 * LEGACY_OWNER_EMAIL (default nj277@cornell.edu). Progress is copied to the
 * stable id user_legacy_nj277 and claimed on the first verified Google
 * sign-in for that email. If cornell.edu is not a Google account, set
 * LEGACY_OWNER_EMAIL to a personal Gmail before the first apply.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { BACKUP_REMINDER, assertMigrationTarget, planMigration, type MigrationItem } from "../lib/migration";
import { appTimeZone } from "../lib/forecast";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const backedUp = args.has("--i-backed-up");

console.error(BACKUP_REMINDER);

const target = assertMigrationTarget({
  tableName: process.env.TABLE_NAME,
  endpoint: process.env.DYNAMODB_ENDPOINT,
  allowRemote: process.env.MIGRATION_ALLOW_REMOTE === "1",
});
if (!target.ok) {
  console.error(target.reason);
  process.exit(1);
}
if (apply && !backedUp) {
  console.error("Refusing to write without --i-backed-up. Take a backup first, then re-run.");
  process.exit(1);
}

const endpoint = process.env.DYNAMODB_ENDPOINT;
const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.APP_REGION || "us-east-1",
    ...(endpoint ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {}),
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

async function scanAll(): Promise<MigrationItem[]> {
  const items: MigrationItem[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: process.env.TABLE_NAME,
        ExclusiveStartKey: startKey as never,
      })
    );
    items.push(...((res.Items ?? []) as MigrationItem[]));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

const items = await scanAll();
const plan = planMigration(items, {
  ownerEmail: process.env.LEGACY_OWNER_EMAIL,
  now: new Date().toISOString(),
  timeZone: appTimeZone(),
  dryRun: !apply,
});

console.log(JSON.stringify(plan.report, null, 2));
if (!apply) {
  console.log("Dry run only. No items were written. Re-run with --apply --i-backed-up after a backup.");
  process.exit(0);
}

let written = 0;
let skipped = 0;
for (const item of plan.puts) {
  try {
    await client.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: item,
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
    written += 1;
  } catch (error) {
    if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
      skipped += 1;
      continue;
    }
    throw error;
  }
}
console.log(JSON.stringify({ written, skipped, deletes: 0 }, null, 2));
