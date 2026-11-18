import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { AccessError } from "./access-error";
import { getAppSession } from "./app-session";
import { getDocClient, tableName } from "./dynamo";
import {
  groupFromItem,
  isValidGroupId,
  MAX_GROUPS_PER_USER,
  practiceGroupKey,
  practiceGroupPrefix,
  type GroupInput,
  type PracticeGroup,
} from "./practice-groups";
import type { AppSession } from "./principal";

/**
 * Practice groups live in the signed-in learner's own partition. Every call
 * derives the key from the server session, never from a client-supplied user.
 * Admin accounts do not study, so they cannot own groups.
 */
async function learnerSession(): Promise<AppSession> {
  const session = await getAppSession();
  if (!session) throw new AccessError(401, "unauthorized");
  if (session.role === "admin") throw new AccessError(403, "admin accounts cannot study");
  return session;
}

function isConditionFailure(error: unknown): boolean {
  return error instanceof Error && error.name === "ConditionalCheckFailedException";
}

export async function listPracticeGroups(): Promise<PracticeGroup[]> {
  const session = await learnerSession();
  const prefix = practiceGroupPrefix(session.userId);
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await getDocClient().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": prefix.PK, ":sk": prefix.SK },
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      })
    );
    items.push(...((res.Items ?? []) as Record<string, unknown>[]));
    startKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items
    .flatMap((item) => groupFromItem(item) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

export async function getPracticeGroup(id: string): Promise<PracticeGroup | null> {
  const session = await learnerSession();
  if (!isValidGroupId(id)) return null;
  const res = await getDocClient().send(
    new GetCommand({ TableName: tableName(), Key: practiceGroupKey(session.userId, id), ConsistentRead: true })
  );
  return res.Item ? groupFromItem(res.Item as Record<string, unknown>) : null;
}

export async function createPracticeGroup(input: GroupInput): Promise<PracticeGroup> {
  const session = await learnerSession();
  // Soft limit: count-then-insert is not atomic, so concurrent creates can
  // overshoot MAX_GROUPS_PER_USER by a few. That is acceptable for a per-user
  // abuse guard; an exact cap would need a transactional counter item.
  const existing = await listPracticeGroups();
  if (existing.length >= MAX_GROUPS_PER_USER) throw new AccessError(403, "too many practice groups");
  const now = new Date().toISOString();
  const group: PracticeGroup = {
    id: randomUUID(),
    name: input.name,
    deckIds: input.deckIds,
    ...(input.examDate ? { examDate: input.examDate } : {}),
    ...(typeof input.targetRecall === "number" ? { targetRecall: input.targetRecall } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await getDocClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...practiceGroupKey(session.userId, group.id),
        kind: "practiceGroup",
        ownerUserId: session.userId,
        name: group.name,
        deckIds: group.deckIds,
        ...(group.examDate ? { examDate: group.examDate } : {}),
        ...(group.targetRecall !== undefined ? { targetRecall: group.targetRecall } : {}),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );
  return group;
}

export async function updatePracticeGroup(id: string, input: Partial<GroupInput>): Promise<PracticeGroup> {
  const session = await learnerSession();
  if (!isValidGroupId(id)) throw new AccessError(404, "group not found");
  const names: Record<string, string> = { "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString() };
  const sets = ["#updatedAt = :updatedAt"];
  if (input.name !== undefined) {
    names["#name"] = "name";
    values[":name"] = input.name;
    sets.push("#name = :name");
  }
  if (input.deckIds !== undefined) {
    names["#deckIds"] = "deckIds";
    values[":deckIds"] = input.deckIds;
    sets.push("#deckIds = :deckIds");
  }
  const removes: string[] = [];
  for (const field of ["examDate", "targetRecall"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    names[`#${field}`] = field;
    if (value === null) removes.push(`#${field}`);
    else {
      values[`:${field}`] = value;
      sets.push(`#${field} = :${field}`);
    }
  }
  try {
    const res = await getDocClient().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: practiceGroupKey(session.userId, id),
        UpdateExpression: `SET ${sets.join(", ")}${removes.length > 0 ? ` REMOVE ${removes.join(", ")}` : ""}`,
        // Never create a group by updating a missing or foreign id.
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );
    const group = res.Attributes ? groupFromItem(res.Attributes as Record<string, unknown>) : null;
    if (!group) throw new AccessError(404, "group not found");
    return group;
  } catch (error) {
    if (isConditionFailure(error)) throw new AccessError(404, "group not found");
    throw error;
  }
}

export async function deletePracticeGroup(id: string): Promise<void> {
  const session = await learnerSession();
  if (!isValidGroupId(id)) throw new AccessError(404, "group not found");
  try {
    await getDocClient().send(
      new DeleteCommand({
        TableName: tableName(),
        Key: practiceGroupKey(session.userId, id),
        ConditionExpression: "attribute_exists(PK)",
      })
    );
  } catch (error) {
    if (isConditionFailure(error)) throw new AccessError(404, "group not found");
    throw error;
  }
}
