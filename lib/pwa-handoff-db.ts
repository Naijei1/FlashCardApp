import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, observeDbLatency, tableName } from "./dynamo";
import {
  HANDOFF_ID,
  type CreateWindow,
  type HandoffRecord,
  type HandoffSession,
  type HandoffStatus,
  type OAuthBundle,
  type OAuthCookie,
  type PwaAuthStore,
} from "./pwa-handoff";

const PK = "AUTH#PWA";
const RATE_KEY = /^[a-f0-9]{64}$/;
const STATE_HASH = /^[a-f0-9]{64}$/;

function isConflict(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

function handoffKey(id: string): string {
  if (!HANDOFF_ID.test(id)) throw new Error("invalid handoff id");
  return `HANDOFF#${id}`;
}

function oauthKey(stateHash: string): string {
  if (!STATE_HASH.test(stateHash)) throw new Error("invalid oauth state");
  return `OAUTH#${stateHash}`;
}

function rateKey(key: string): string {
  if (!RATE_KEY.test(key)) throw new Error("invalid handoff rate key");
  return `RATE#${key}`;
}

function toStatus(value: unknown): HandoffStatus | null {
  if (value === "pending" || value === "ready" || value === "claimed") return value;
  return null;
}

function toRecord(item: Record<string, unknown> | undefined): HandoffRecord | null {
  if (!item) return null;
  const id = item.id;
  const secretHash = item.secretHash;
  const confirmCode = item.confirmCode;
  const status = toStatus(item.status);
  const expiresAt = item.expiresAt;
  if (typeof id !== "string" || !HANDOFF_ID.test(id)) return null;
  if (typeof secretHash !== "string" || typeof confirmCode !== "string" || !status) return null;
  if (typeof expiresAt !== "number") return null;
  return {
    id,
    secretHash,
    confirmCode,
    status,
    expiresAt,
    appUserId: typeof item.appUserId === "string" ? item.appUserId : "",
    email: typeof item.email === "string" ? item.email : "",
    sessionId: typeof item.sessionId === "string" ? item.sessionId : "",
    sessionVersion: typeof item.sessionVersion === "number" ? item.sessionVersion : 0,
  };
}

function toCookies(value: unknown): OAuthCookie[] {
  if (!Array.isArray(value)) return [];
  const cookies: OAuthCookie[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const cookieValue = (entry as { value?: unknown }).value;
    if (typeof name !== "string" || typeof cookieValue !== "string") continue;
    cookies.push({ name, value: cookieValue });
  }
  return cookies;
}

function toBundle(item: Record<string, unknown> | undefined): OAuthBundle | null {
  if (!item) return null;
  const stateHash = item.stateHash;
  const handoffId = item.handoffId;
  const expiresAt = item.expiresAt;
  if (typeof stateHash !== "string" || typeof handoffId !== "string" || typeof expiresAt !== "number") return null;
  if (!HANDOFF_ID.test(handoffId)) return null;
  return { stateHash, handoffId, expiresAt, cookies: toCookies(item.cookies) };
}

function toWindow(item: Record<string, unknown> | undefined): CreateWindow | null {
  if (!item) return null;
  const count = item.count;
  const windowStartedAt = item.windowStartedAt;
  if (typeof count !== "number" || typeof windowStartedAt !== "number") return null;
  return { count, windowStartedAt };
}

export const dynamoPwaAuthStore: PwaAuthStore = {
  async saveHandoff(record) {
    await observeDbLatency("auth.pwa.handoff.put", () =>
      getDocClient().send(
        new PutCommand({
          TableName: tableName(),
          Item: {
            PK,
            SK: handoffKey(record.id),
            ...record,
            ttl: Math.ceil(record.expiresAt / 1000),
          },
          ConditionExpression: "attribute_not_exists(PK)",
        })
      )
    );
  },
  async readHandoff(id) {
    const res = await observeDbLatency("auth.pwa.handoff.get", () =>
      getDocClient().send(
        new GetCommand({
          TableName: tableName(),
          Key: { PK, SK: handoffKey(id) },
          ConsistentRead: true,
        })
      )
    );
    return toRecord(res.Item);
  },
  async markReady(id, session: HandoffSession, now) {
    try {
      await observeDbLatency("auth.pwa.handoff.ready", () =>
        getDocClient().send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { PK, SK: handoffKey(id) },
            UpdateExpression:
              "SET #status = :ready, appUserId = :appUserId, email = :email, sessionId = :sessionId, sessionVersion = :sessionVersion",
            ConditionExpression: "#status = :pending AND expiresAt > :now",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":ready": "ready",
              ":pending": "pending",
              ":now": now,
              ":appUserId": session.appUserId,
              ":email": session.email,
              ":sessionId": session.sessionId,
              ":sessionVersion": session.sessionVersion,
            },
          })
        )
      );
      return true;
    } catch (error) {
      if (isConflict(error)) return false;
      throw error;
    }
  },
  async markClaimed(id, now) {
    try {
      await observeDbLatency("auth.pwa.handoff.claim", () =>
        getDocClient().send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { PK, SK: handoffKey(id) },
            UpdateExpression: "SET #status = :claimed",
            ConditionExpression: "#status = :ready AND expiresAt > :now",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":claimed": "claimed",
              ":ready": "ready",
              ":now": now,
            },
          })
        )
      );
      return true;
    } catch (error) {
      if (isConflict(error)) return false;
      throw error;
    }
  },
  async saveOAuth(bundle) {
    await observeDbLatency("auth.pwa.oauth.put", () =>
      getDocClient().send(
        new PutCommand({
          TableName: tableName(),
          Item: {
            PK,
            SK: oauthKey(bundle.stateHash),
            stateHash: bundle.stateHash,
            handoffId: bundle.handoffId,
            cookies: bundle.cookies,
            expiresAt: bundle.expiresAt,
            ttl: Math.ceil(bundle.expiresAt / 1000),
          },
          ConditionExpression: "attribute_not_exists(PK)",
        })
      )
    );
  },
  async takeOAuth(stateHash, now) {
    const got = await observeDbLatency("auth.pwa.oauth.get", () =>
      getDocClient().send(
        new GetCommand({
          TableName: tableName(),
          Key: { PK, SK: oauthKey(stateHash) },
          ConsistentRead: true,
        })
      )
    );
    const bundle = toBundle(got.Item);
    if (!bundle || bundle.expiresAt <= now || got.Item?.consumed === true) return null;
    try {
      await observeDbLatency("auth.pwa.oauth.take", () =>
        getDocClient().send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { PK, SK: oauthKey(stateHash) },
            UpdateExpression: "SET consumed = :yes",
            ConditionExpression: "attribute_not_exists(consumed) AND expiresAt > :now",
            ExpressionAttributeValues: { ":yes": true, ":now": now },
          })
        )
      );
      return bundle;
    } catch (error) {
      if (isConflict(error)) return null;
      throw error;
    }
  },
  async readCreateWindow(key) {
    const res = await observeDbLatency("auth.pwa.rate.get", () =>
      getDocClient().send(
        new GetCommand({
          TableName: tableName(),
          Key: { PK, SK: rateKey(key) },
          ConsistentRead: true,
        })
      )
    );
    return toWindow(res.Item);
  },
  async saveCreateWindow(key, next, expected) {
    const ttl = Math.ceil((next.windowStartedAt + 15 * 60 * 1000) / 1000) + 120;
    try {
      if (expected === "absent") {
        await observeDbLatency("auth.pwa.rate.put", () =>
          getDocClient().send(
            new PutCommand({
              TableName: tableName(),
              Item: { PK, SK: rateKey(key), ...next, ttl },
              ConditionExpression: "attribute_not_exists(PK)",
            })
          )
        );
      } else {
        await observeDbLatency("auth.pwa.rate.update", () =>
          getDocClient().send(
            new UpdateCommand({
              TableName: tableName(),
              Key: { PK, SK: rateKey(key) },
              UpdateExpression: "SET #count = :count, windowStartedAt = :windowStartedAt, #ttl = :ttl",
              ConditionExpression: "#count = :oldCount AND windowStartedAt = :oldWindow",
              ExpressionAttributeNames: { "#count": "count", "#ttl": "ttl" },
              ExpressionAttributeValues: {
                ":count": next.count,
                ":windowStartedAt": next.windowStartedAt,
                ":ttl": ttl,
                ":oldCount": expected.count,
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
};
