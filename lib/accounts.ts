import { randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AccessError } from "./access-error";
import { doc, tableName } from "./dynamo";
import {
  claimKey,
  googleAuthKey,
  normalizeEmail,
  planAccountLink,
  userDirectoryKey,
  userProfileKey,
  type AccountPlan,
} from "./multi-user-model";
import type { Role } from "./principal";

export type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
};

export type LinkedUser = {
  userId: string;
  email: string;
  role: Role;
};

async function readItem(key: { PK: string; SK: string }): Promise<Record<string, unknown> | null> {
  const res = await doc.send(
    new GetCommand({ TableName: tableName(), Key: key, ConsistentRead: true })
  );
  return (res.Item as Record<string, unknown> | undefined) ?? null;
}

function allowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);
}

/**
 * Stable app user ids are created here and stored on AUTH#google#<sub>.
 * The migrated placeholder is claimed once, by verified email, then only the
 * Google subject matches that user.
 */
export async function resolveGoogleUser(identity: GoogleIdentity): Promise<LinkedUser> {
  const email = normalizeEmail(identity.email);
  const link = await readItem(googleAuthKey(identity.sub));
  const claim = await readItem(claimKey(email));
  const plan = planAccountLink({
    sub: identity.sub,
    email,
    emailVerified: identity.emailVerified,
    adminAllowlist: allowlist(),
    existingLinkUserId: typeof link?.userId === "string" ? link.userId : null,
    claim:
      claim && typeof claim.userId === "string"
        ? {
            userId: claim.userId,
            claimedSub: typeof claim.claimedSub === "string" ? claim.claimedSub : null,
          }
        : null,
  });
  if (plan.action === "reject") {
    throw new AccessError(
      403,
      plan.reason === "unverified-email"
        ? "Google did not report a verified email"
        : "Google account is missing a usable subject or email"
    );
  }
  const now = new Date().toISOString();
  if (plan.action === "existing") {
    if (
      claim &&
      typeof claim.userId === "string" &&
      !claim.claimedSub &&
      claim.userId !== plan.userId &&
      plan.role !== "admin"
    ) {
      const repaired = await repairEmptyClaim({
        sub: identity.sub,
        email,
        role: plan.role,
        emptyUserId: plan.userId,
        claimUserId: claim.userId,
        now,
      });
      if (repaired) return repaired;
    }
    await touchProfile(plan.userId, email, plan.role, now);
    return { userId: plan.userId, email, role: plan.role };
  }
  if (plan.action === "claim") {
    const claimed = await claimPlaceholder(plan, identity.sub, email, now);
    if (claimed) return claimed;
  }
  return createUser(identity.sub, email, plan.role, now);
}

async function touchProfile(userId: string, email: string, role: Role, now: string): Promise<void> {
  const names = { "#email": "email", "#role": "role", "#seen": "lastSeenAt", "#status": "status" };
  const values = { ":email": email, ":role": role, ":seen": now, ":status": "active" };
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: userProfileKey(userId),
      UpdateExpression: "SET #email = :email, #role = :role, #seen = :seen, #status = :status",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
  await doc.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: userDirectoryKey(userId),
      UpdateExpression:
        "SET #email = :email, #role = :role, #seen = :seen, #status = :status, userId = if_not_exists(userId, :userId)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: { ...values, ":userId": userId },
    })
  );
}

async function accountHasProgress(userId: string): Promise<boolean> {
  const directory = await readItem(userDirectoryKey(userId));
  const reviews = typeof directory?.reviewCount === "number" ? directory.reviewCount : 0;
  const studied = typeof directory?.cardsStudied === "number" ? directory.cardsStudied : 0;
  if (reviews > 0 || studied > 0) return true;
  const res = await doc.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "PROGRESS#" },
      Limit: 1,
      ConsistentRead: true,
    })
  );
  return (res.Count ?? res.Items?.length ?? 0) > 0;
}

/**
 * A failed claim can leave a brand-new empty user beside the unclaimed
 * placeholder. Move the Google link only when that account has no progress.
 */
async function repairEmptyClaim(input: {
  sub: string;
  email: string;
  role: Role;
  emptyUserId: string;
  claimUserId: string;
  now: string;
}): Promise<LinkedUser | null> {
  if (await accountHasProgress(input.emptyUserId)) return null;
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName(),
              Key: googleAuthKey(input.sub),
              UpdateExpression: "SET userId = :claimUser, email = :email",
              ConditionExpression: "userId = :emptyUser",
              ExpressionAttributeValues: {
                ":claimUser": input.claimUserId,
                ":email": input.email,
                ":emptyUser": input.emptyUserId,
              },
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: claimKey(input.email),
              UpdateExpression: "SET claimedSub = :sub, claimedAt = :now",
              ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(claimedSub)",
              ExpressionAttributeValues: { ":sub": input.sub, ":now": input.now },
            },
          },
        ],
      })
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
    return null;
  }
  await touchProfile(input.claimUserId, input.email, input.role, input.now);
  return { userId: input.claimUserId, email: input.email, role: input.role };
}

async function claimPlaceholder(
  plan: Extract<AccountPlan, { action: "claim" }>,
  sub: string,
  email: string,
  now: string
): Promise<LinkedUser | null> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await doc.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName(),
                Item: { ...googleAuthKey(sub), userId: plan.userId, email, linkedAt: now },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: tableName(),
                Key: claimKey(email),
                UpdateExpression: "SET claimedSub = :sub, claimedAt = :now",
                ConditionExpression:
                  "attribute_exists(PK) AND (attribute_not_exists(claimedSub) OR claimedSub = :sub)",
                ExpressionAttributeValues: { ":sub": sub, ":now": now },
              },
            },
          ],
        })
      );
      await touchProfile(plan.userId, email, plan.role, now);
      return { userId: plan.userId, email, role: plan.role };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
      const link = await readItem(googleAuthKey(sub));
      if (typeof link?.userId === "string") {
        await touchProfile(link.userId, email, plan.role, now);
        return { userId: link.userId, email, role: plan.role };
      }
      const currentClaim = await readItem(claimKey(email));
      const claimedSub = typeof currentClaim?.claimedSub === "string" ? currentClaim.claimedSub : "";
      if (claimedSub && claimedSub !== sub) return null;
      if (attempt + 1 < maxAttempts) continue;
      throw error;
    }
  }
  throw new Error("legacy claim did not complete");
}

async function createUser(sub: string, email: string, role: Role, now: string): Promise<LinkedUser> {
  const userId = `user_${randomUUID()}`;
  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: { ...googleAuthKey(sub), userId, email, linkedAt: now },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              ...userProfileKey(userId),
              userId,
              email,
              role,
              status: "active",
              createdAt: now,
              lastSeenAt: now,
              authProvider: "google",
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              ...userDirectoryKey(userId),
              userId,
              email,
              role,
              status: "active",
              createdAt: now,
              lastSeenAt: now,
              cardsStudied: 0,
              reviewCount: 0,
              currentStreak: 0,
            },
            ConditionExpression: "attribute_not_exists(PK)",
          },
        },
      ],
    })
  );
  return { userId, email, role };
}
