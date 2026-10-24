/**
 * Copy legacy decks and card progress onto multi-user keys.
 *
 * Dry run is the default. Nothing is written unless you pass --apply and
 * --i-backed-up. TABLE_NAME=flashcards stays refused unless
 * MIGRATION_ALLOW_PRODUCTION=1 is set as well; a write to that table still
 * needs both flags. MIGRATION_ALLOW_REMOTE=1 does not unlock production.
 *
 *   npm run migrate:multi-user
 *   npm run migrate:multi-user -- --apply --i-backed-up
 *   MIGRATION_ALLOW_PRODUCTION=1 npm run migrate:multi-user -- --apply --i-backed-up
 *
 * Reads TABLE_NAME, APP_REGION, DYNAMODB_ENDPOINT, and optional
 * LEGACY_OWNER_EMAIL (default naijeiwow@gmail.com). Progress is copied to the
 * stable id user_legacy_owner and claimed on the first verified Google
 * sign-in for that email. nj277@cornell.edu is the admin account, not the
 * study account. Do not put the study Gmail in ADMIN_EMAILS.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { BACKUP_REMINDER, assertMigrationTarget, planMigration, type MigrationItem } from "../lib/migration";
import { appTimeZone } from "../lib/forecast";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const backedUp = args.has("--i-backed-up");

function documentClient(): DynamoDBDocumentClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.APP_REGION || "us-east-1",
      ...(endpoint ? { endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } } : {}),
    }),
    { marshallOptions: { removeUndefinedValues: true } }
  );
}

async function scanAll(client: DynamoDBDocumentClient): Promise<MigrationItem[]> {
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

async function main(): Promise<void> {
  console.error(BACKUP_REMINDER);

  const target = assertMigrationTarget({
    tableName: process.env.TABLE_NAME,
    endpoint: process.env.DYNAMODB_ENDPOINT,
    allowRemote: process.env.MIGRATION_ALLOW_REMOTE === "1",
    allowProduction: process.env.MIGRATION_ALLOW_PRODUCTION === "1",
    apply,
    backedUp,
  });
  if (!target.ok) {
    console.error(target.reason);
    process.exit(1);
  }
  if (apply && !backedUp) {
    console.error("Refusing to write without --i-backed-up. Take a backup first, then re-run.");
    process.exit(1);
  }

  const client = documentClient();
  const items = await scanAll(client);
  const plan = planMigration(items, {
    ownerEmail: process.env.LEGACY_OWNER_EMAIL,
    now: new Date().toISOString(),
    timeZone: appTimeZone(),
    dryRun: !apply,
  });

  console.log(JSON.stringify(plan.report, null, 2));
  if (!apply) {
    console.log("Dry run only. No items were written. Re-run with --apply --i-backed-up after a backup.");
    return;
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
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "migration failed");
  process.exit(1);
});
