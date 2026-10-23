import { createHash, randomBytes } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { SHARED_USER_ID, SESSION_MAX_AGE_SECONDS } from "./constants";
import { getDocClient, observeDbLatency, tableName } from "./dynamo";
import {
  LOGIN_WINDOW_MS,
  limitLogin,
  type AttemptExpectation,
  type AttemptState,
  type AttemptStore,
  type LoginLimitResult,
} from "./login-limit";

const LOGIN_PK = "AUTH#LOGIN";
const AUTH_SK = "AUTH";
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * Pre-Cognito sessions live on the same single table as cards, under the user
 * partition from docs/multi-user-design.md. `shared` is the current principal
 * and should migrate to Naijei's regular user, not the admin account.
 *
 *   PK = USER#<userId>  SK = AUTH                 sessionVersion
 *   PK = USER#<userId>  SK = SESSION#<sessionId>  expiresAt, ttl
 *
 * Login failures are separate and never touch card or progress items:
 *   PK = AUTH#LOGIN     SK = ATTEMPT#<key hash>   ttl
 */
export function assertUserId(userId: string): string {
  if (!USER_ID.test(userId)) throw new Error("invalid user id");
  return userId;
}

export function userKey(userId: string): string {
  return `USER#${assertUserId(userId)}`;
}

function sessionKey(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("invalid session id");
  return `SESSION#${sessionId}`;
}

/** Stable, non-reversible rate-limit key. Raw client addresses are not stored. */
export function hashLoginKey(rawKey: string): string {
  const pepper = process.env.SESSION_SECRET_HEX || process.env.SESSION_SECRET || "flashcards-login";
  return createHash("sha256").update(`${pepper}\0${rawKey}`).digest("hex");
}

function isConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function toAttempt(item: Record<string, unknown> | undefined): AttemptState | null {
  if (!item) return null;
  const failures = item.failures;
  const windowStartedAt = item.windowStartedAt;
  const blockedUntil = item.blockedUntil;
  if (typeof failures !== "number" || typeof windowStartedAt !== "number") return null;
  return {
    failures,
    windowStartedAt,
    blockedUntil: typeof blockedUntil === "number" ? blockedUntil : 0,
  };
}

export const dynamoLoginStore: AttemptStore = {
  async get(key) {
    const res = await observeDbLatency("auth.login.get", () =>
      getDocClient().send(
        new GetCommand({
          TableName: tableName(),
          Key: { PK: LOGIN_PK, SK: `ATTEMPT#${key}` },
          ConsistentRead: true,
        })
      )
    );
    return toAttempt(res.Item);
  },
  async save(key, next, expected: AttemptExpectation) {
    const ttl = Math.ceil((next.windowStartedAt + LOGIN_WINDOW_MS) / 1000) + 120;
    try {
      if (expected === "absent") {
        await observeDbLatency("auth.login.put", () =>
          getDocClient().send(
            new PutCommand({
              TableName: tableName(),
              Item: { PK: LOGIN_PK, SK: `ATTEMPT#${key}`, ...next, ttl },
              ConditionExpression: "attribute_not_exists(PK)",
            })
          )
        );
      } else {
        await observeDbLatency("auth.login.update", () =>
          getDocClient().send(
            new UpdateCommand({
              TableName: tableName(),
              Key: { PK: LOGIN_PK, SK: `ATTEMPT#${key}` },
              UpdateExpression:
                "SET failures = :failures, windowStartedAt = :windowStartedAt, blockedUntil = :blockedUntil, #ttl = :ttl",
              ConditionExpression: "failures = :oldFailures AND windowStartedAt = :oldWindow",
              ExpressionAttributeNames: { "#ttl": "ttl" },
              ExpressionAttributeValues: {
                ":failures": next.failures,
                ":windowStartedAt": next.windowStartedAt,
                ":blockedUntil": next.blockedUntil,
                ":ttl": ttl,
                ":oldFailures": expected.failures,
                ":oldWindow": expected.windowStartedAt,
              },
            })
          )
        );
      }
      return true;
    } catch (error) {
      if (isConflict(error)) return false;
      throw error;
    }
  },
  async delete(key) {
    await observeDbLatency("auth.login.delete", () =>
      getDocClient().send(
        new DeleteCommand({
          TableName: tableName(),
          Key: { PK: LOGIN_PK, SK: `ATTEMPT#${key}` },
        })
      )
    );
  },
};

export function limitSharedLogin(
  rawKey: string,
  now: number,
  checkPassword: () => boolean | Promise<boolean>
): Promise<LoginLimitResult> {
  return limitLogin(dynamoLoginStore, hashLoginKey(rawKey), now, checkPassword);
}

export async function beginSession(
  userId: string = SHARED_USER_ID,
  now = Date.now()
): Promise<{ sessionId: string; sessionVersion: number }> {
  const pk = userKey(userId);
  const auth = await observeDbLatency("auth.session.version", () =>
    getDocClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pk, SK: AUTH_SK },
        UpdateExpression:
          "SET sessionVersion = if_not_exists(sessionVersion, :one), updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":one": 1,
          ":updatedAt": new Date(now).toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
    )
  );
  const sessionVersion = auth.Attributes?.sessionVersion;
  if (typeof sessionVersion !== "number" || !Number.isSafeInteger(sessionVersion) || sessionVersion < 1) {
    throw new Error("session version was not stored");
  }
  const sessionId = randomBytes(16).toString("base64url");
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  await observeDbLatency("auth.session.put", () =>
    getDocClient().send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: pk,
          SK: sessionKey(sessionId),
          sessionVersion,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          ttl: Math.ceil(expiresAt / 1000),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      })
    )
  );
  return { sessionId, sessionVersion };
}

export async function sessionIsCurrent(
  userId: string,
  sessionId: string,
  sessionVersion: number,
  now = Date.now()
): Promise<boolean> {
  if (!USER_ID.test(userId) || !SESSION_ID.test(sessionId)) return false;
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 1) return false;
  const pk = userKey(userId);
  const [auth, session] = await observeDbLatency("auth.session.read", () =>
    Promise.all([
      getDocClient().send(
        new GetCommand({
          TableName: tableName(),
          Key: { PK: pk, SK: AUTH_SK },
          ConsistentRead: true,
        })
      ),
      getDocClient().send(
        new GetCommand({
          TableName: tableName(),
          Key: { PK: pk, SK: sessionKey(sessionId) },
          ConsistentRead: true,
        })
      ),
    ])
  );
  if (auth.Item?.sessionVersion !== sessionVersion) return false;
  const expiresAt = Date.parse(String(session.Item?.expiresAt ?? ""));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  if (!USER_ID.test(userId) || !SESSION_ID.test(sessionId)) return;
  await observeDbLatency("auth.session.delete", () =>
    getDocClient().send(
      new DeleteCommand({
        TableName: tableName(),
        Key: { PK: userKey(userId), SK: sessionKey(sessionId) },
      })
    )
  );
}

/** Bumps the per-user session version so every existing JWT for that user fails. */
export async function revokeAllSessions(userId: string, now = Date.now()): Promise<void> {
  await observeDbLatency("auth.session.revokeAll", () =>
    getDocClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: userKey(userId), SK: AUTH_SK },
        UpdateExpression: "ADD sessionVersion :one SET updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":one": 1,
          ":updatedAt": new Date(now).toISOString(),
        },
      })
    )
  );
}
