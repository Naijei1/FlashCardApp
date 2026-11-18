import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGroupInput, practiceGroupKey } from "@/lib/practice-groups";

const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/dynamo", () => ({
  doc: { send: mocks.send },
  getDocClient: () => ({ send: mocks.send }),
  observeDbLatency: (_name: string, work: () => Promise<unknown>) => work(),
  tableName: () => "test-table",
}));
vi.mock("@/lib/app-session", () => ({ getAppSession: mocks.session }));

const learnerA = { userId: "user-a", email: "a@example.com", role: "user", emailVerified: true, authMode: "google" };
const learnerB = { userId: "user-b", email: "b@example.com", role: "user", emailVerified: true, authMode: "google" };
const admin = { userId: "admin-1", email: "admin@example.com", role: "admin", emailVerified: true, authMode: "google" };

const at = "2026-10-01T00:00:00.000Z";
const now = new Date("2026-11-17T12:00:00.000Z");

type Command = { constructor: { name: string }; input: Record<string, unknown> };

/** A tiny in-memory table: enough for Get/Put/Update/Delete/Query on PK+SK. */
function fakeTable(seed: Record<string, unknown>[] = []) {
  const items = new Map<string, Record<string, unknown>>();
  const id = (key: { PK: unknown; SK: unknown }) => `${key.PK}\u0000${key.SK}`;
  for (const item of seed) items.set(id(item as { PK: string; SK: string }), item);
  const conditionFailed = () => Object.assign(new Error("condition"), { name: "ConditionalCheckFailedException" });
  mocks.send.mockImplementation(async (command: Command) => {
    const input = command.input;
    const name = command.constructor.name;
    if (name === "GetCommand") return { Item: items.get(id(input.Key as never)) };
    if (name === "PutCommand") {
      const item = input.Item as Record<string, unknown>;
      if (input.ConditionExpression && items.has(id(item as never))) throw conditionFailed();
      items.set(id(item as never), item);
      return {};
    }
    if (name === "DeleteCommand") {
      if (!items.has(id(input.Key as never))) throw conditionFailed();
      items.delete(id(input.Key as never));
      return {};
    }
    if (name === "UpdateCommand") {
      const existing = items.get(id(input.Key as never));
      if (!existing) throw conditionFailed();
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      const updated = { ...existing };
      const [setPart, removePart] = String(input.UpdateExpression).replace(/^SET /, "").split(" REMOVE ");
      for (const part of setPart.split(", ")) {
        const [lhs, rhs] = part.split(" = ");
        updated[names[lhs]] = values[rhs];
      }
      for (const name of removePart?.split(", ") ?? []) delete updated[names[name]];
      items.set(id(input.Key as never), updated);
      return { Attributes: updated };
    }
    if (name === "QueryCommand") {
      const values = input.ExpressionAttributeValues as Record<string, string>;
      return {
        Items: [...items.values()].filter((item) =>
          item.PK === values[":pk"] && (values[":sk"] === undefined || String(item.SK).startsWith(values[":sk"]))),
      };
    }
    if (name === "TransactWriteCommand") throw new Error("cram must not write transactions");
    throw new Error(`unexpected ${name}`);
  });
  return items;
}

function globalDeck(id: string, extra: Record<string, unknown>) {
  return { PK: "GLOBAL#DECKS", SK: `DECK#${id}`, name: id, source: "global", createdAt: at, updatedAt: at, ...extra };
}
function globalCard(deckId: string, cardId: string, front: string, back: string) {
  return { PK: `GLOBAL#DECK#${deckId}`, SK: `CARD#${cardId}`, front, back, createdAt: at, updatedAt: at };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  process.env.DATA_MODE = "multi-user";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DATA_MODE;
});

describe("input validation", () => {
  const allowed = new Set(["l6", "l7"]);
  it("requires a name and visible lessons", () => {
    expect(parseGroupInput({ name: " ", deckIds: ["l6"] }, allowed)).toMatchObject({ ok: false });
    expect(parseGroupInput({ name: "Final", deckIds: [] }, allowed)).toMatchObject({ ok: false });
    expect(parseGroupInput({ name: "Final", deckIds: ["l6", "secret-week"] }, allowed)).toMatchObject({ ok: false });
    expect(parseGroupInput({ name: "Final:  L6-7", deckIds: ["l6", "l7", "l6"] }, allowed)).toEqual({
      ok: true,
      value: { name: "Final: L6-7", deckIds: ["l6", "l7"] },
    });
    expect(parseGroupInput({ name: "Renamed" }, allowed, { partial: true })).toEqual({ ok: true, value: { name: "Renamed" } });
  });

  it("validates an optional exam date and target recall", () => {
    const today = "2026-11-17";
    const parse = (body: Record<string, unknown>) => parseGroupInput({ name: "Final", deckIds: ["l6"], ...body }, allowed, { today });
    expect(parse({ examDate: "2026-12-18", targetRecall: 0.9 })).toEqual({
      ok: true, value: { name: "Final", deckIds: ["l6"], examDate: "2026-12-18", targetRecall: 0.9 },
    });
    expect(parse({ examDate: today })).toMatchObject({ ok: true, value: { examDate: today } });
    expect(parse({ examDate: "2026-11-16" })).toEqual({ ok: false, error: "exam date is in the past" });
    expect(parse({ examDate: "2026-02-30" })).toMatchObject({ ok: false });
    expect(parse({ examDate: "12/18/2026" })).toMatchObject({ ok: false });
    expect(parse({ examDate: "2031-01-01" })).toEqual({ ok: false, error: "exam date is too far ahead" });
    expect(parse({ targetRecall: 0.8 })).toMatchObject({ ok: false });
    expect(parse({ targetRecall: 0.99 })).toMatchObject({ ok: false });
    expect(parse({ targetRecall: "0.9" })).toMatchObject({ ok: false });
    // null clears either field on update.
    expect(parseGroupInput({ examDate: null, targetRecall: null }, allowed, { partial: true, today })).toEqual({
      ok: true, value: { examDate: null, targetRecall: null },
    });
    expect(parseGroupInput({ examDate: "" }, allowed, { partial: true, today })).toEqual({ ok: true, value: { examDate: null } });
  });
});

describe("group CRUD is scoped to the signed-in learner", () => {
  it("creates, lists, renames, edits, and deletes under USER#<own id>", async () => {
    const items = fakeTable();
    mocks.session.mockResolvedValue(learnerA);
    const store = await import("@/lib/practice-group-store");
    const group = await store.createPracticeGroup({ name: "Final: L6-10", deckIds: ["l6", "l7"] });
    const key = practiceGroupKey("user-a", group.id);
    expect(items.get(`${key.PK}\u0000${key.SK}`)).toMatchObject({ ownerUserId: "user-a", name: "Final: L6-10" });

    expect((await store.listPracticeGroups()).map((g) => g.name)).toEqual(["Final: L6-10"]);
    await store.updatePracticeGroup(group.id, { name: "Final exam" });
    const edited = await store.updatePracticeGroup(group.id, { deckIds: ["l7"] });
    expect(edited).toMatchObject({ name: "Final exam", deckIds: ["l7"] });
    expect(await store.getPracticeGroup(group.id)).toMatchObject({ name: "Final exam", deckIds: ["l7"] });

    await store.deletePracticeGroup(group.id);
    expect(await store.listPracticeGroups()).toEqual([]);
  });

  it("stores, edits, and clears the exam date and target recall", async () => {
    const items = fakeTable();
    mocks.session.mockResolvedValue(learnerA);
    const store = await import("@/lib/practice-group-store");
    const group = await store.createPracticeGroup({ name: "Final", deckIds: ["l6"], examDate: "2026-12-18", targetRecall: 0.9 });
    expect(group).toMatchObject({ examDate: "2026-12-18", targetRecall: 0.9 });
    const key = practiceGroupKey("user-a", group.id);
    expect(items.get(`${key.PK}\u0000${key.SK}`)).toMatchObject({ examDate: "2026-12-18", targetRecall: 0.9 });

    expect(await store.updatePracticeGroup(group.id, { examDate: "2026-12-20" })).toMatchObject({ examDate: "2026-12-20", targetRecall: 0.9 });
    const cleared = await store.updatePracticeGroup(group.id, { examDate: null, targetRecall: null });
    expect(cleared.examDate).toBeUndefined();
    expect(cleared.targetRecall).toBeUndefined();
    expect(items.get(`${key.PK}\u0000${key.SK}`)).not.toHaveProperty("examDate");

    // Corrupt stored values are ignored on read rather than trusted.
    items.set(`${key.PK}\u0000${key.SK}`, { ...items.get(`${key.PK}\u0000${key.SK}`)!, examDate: "soon", targetRecall: 2 });
    const read = await store.getPracticeGroup(group.id);
    expect(read?.examDate).toBeUndefined();
    expect(read?.targetRecall).toBeUndefined();
  });

  it("does not let another learner read, edit, or delete the group", async () => {
    fakeTable();
    mocks.session.mockResolvedValue(learnerA);
    const store = await import("@/lib/practice-group-store");
    const group = await store.createPracticeGroup({ name: "Mine", deckIds: ["l6"] });

    mocks.session.mockResolvedValue(learnerB);
    expect(await store.listPracticeGroups()).toEqual([]);
    expect(await store.getPracticeGroup(group.id)).toBeNull();
    await expect(store.updatePracticeGroup(group.id, { name: "Stolen" })).rejects.toMatchObject({ status: 404 });
    await expect(store.deletePracticeGroup(group.id)).rejects.toMatchObject({ status: 404 });

    mocks.session.mockResolvedValue(learnerA);
    expect(await store.getPracticeGroup(group.id)).toMatchObject({ name: "Mine" });
  });

  it("rejects admin and signed-out callers", async () => {
    fakeTable();
    const store = await import("@/lib/practice-group-store");
    mocks.session.mockResolvedValue(admin);
    await expect(store.listPracticeGroups()).rejects.toMatchObject({ status: 403 });
    await expect(store.createPracticeGroup({ name: "x", deckIds: ["l6"] })).rejects.toMatchObject({ status: 403 });
    mocks.session.mockResolvedValue(null);
    await expect(store.getPracticeGroup("abc")).rejects.toMatchObject({ status: 401 });
  });

  it("rejects ids that could escape the key", async () => {
    fakeTable();
    mocks.session.mockResolvedValue(learnerA);
    const store = await import("@/lib/practice-group-store");
    expect(await store.getPracticeGroup("x#PROGRESS#GLOBAL")).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  function json(body: unknown, method = "POST") {
    return new Request("https://app.test/api/practice-groups", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("refuses to save an unreleased week, and saves released ones", async () => {
    fakeTable([
      globalDeck("week-6", { status: "published", releaseWeek: 6 }),
      globalDeck("week-12", { status: "scheduled", releaseAt: "2026-12-01T00:00:00.000Z", releaseWeek: 12 }),
    ]);
    mocks.session.mockResolvedValue(learnerA);
    const { POST, GET } = await import("@/app/api/practice-groups/route");
    const refused = await POST(json({ name: "Final", deckIds: ["week-6", "week-12"] }));
    expect(refused.status).toBe(400);
    const saved = await POST(json({ name: "Final", deckIds: ["week-6"] }));
    expect(saved.status).toBe(201);
    const listed = await (await GET()).json();
    expect(listed.groups.map((g: { name: string }) => g.name)).toEqual(["Final"]);
  });

  it("returns 403 to the admin and 401 when signed out", async () => {
    fakeTable([globalDeck("week-6", { status: "published" })]);
    const { POST, GET } = await import("@/app/api/practice-groups/route");
    const item = await import("@/app/api/practice-groups/[id]/route");
    mocks.session.mockResolvedValue(admin);
    expect((await GET()).status).toBe(403);
    expect((await POST(json({ name: "x", deckIds: ["week-6"] }))).status).toBe(403);
    expect((await item.DELETE(new Request("https://app.test"), { params: Promise.resolve({ id: "g1" }) })).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("renames and deletes through the item route, 404 for someone else's group", async () => {
    fakeTable([globalDeck("week-6", { status: "published" }), globalDeck("week-7", { status: "published" })]);
    mocks.session.mockResolvedValue(learnerA);
    const { POST } = await import("@/app/api/practice-groups/route");
    const item = await import("@/app/api/practice-groups/[id]/route");
    const group = await (await POST(json({ name: "Final", deckIds: ["week-6"] }))).json();
    const params = { params: Promise.resolve({ id: group.id }) };

    const patched = await item.PATCH(json({ name: "Final v2", deckIds: ["week-6", "week-7"] }, "PATCH"), params);
    expect(await patched.json()).toMatchObject({ name: "Final v2", deckIds: ["week-6", "week-7"] });

    const dated = await item.PATCH(json({ examDate: "2026-12-18", targetRecall: 0.97 }, "PATCH"), params);
    expect(await dated.json()).toMatchObject({ name: "Final v2", examDate: "2026-12-18", targetRecall: 0.97 });
    expect((await item.PATCH(json({ examDate: "2026-11-01" }, "PATCH"), params)).status).toBe(400);
    expect((await item.PATCH(json({ targetRecall: 0.5 }, "PATCH"), params)).status).toBe(400);
    expect((await POST(json({ name: "Bad", deckIds: ["week-6"], examDate: "tomorrow" }))).status).toBe(400);
    const undated = await item.PATCH(json({ examDate: null }, "PATCH"), params);
    expect(await undated.json()).not.toHaveProperty("examDate");

    mocks.session.mockResolvedValue(learnerB);
    expect((await item.GET(new Request("https://app.test"), params)).status).toBe(404);
    expect((await item.PATCH(json({ name: "mine now" }, "PATCH"), params)).status).toBe(404);
    expect((await item.DELETE(new Request("https://app.test"), params)).status).toBe(404);

    mocks.session.mockResolvedValue(learnerA);
    expect((await item.DELETE(new Request("https://app.test"), params)).status).toBe(200);
    expect((await item.GET(new Request("https://app.test"), params)).status).toBe(404);
  });
});

describe("cram set release gating", () => {
  it("skips a lesson that is unreleased again, hidden cards, and archived lessons, without writing", async () => {
    const items = fakeTable([
      globalDeck("week-6", { status: "published", releaseWeek: 6 }),
      // Saved while visible, then rescheduled into the future.
      globalDeck("week-9", { status: "scheduled", releaseAt: "2026-12-01T00:00:00.000Z", releaseWeek: 9 }),
      globalDeck("week-7", { status: "published", releaseWeek: 7, archivedAt: at }),
      globalCard("week-6", "a", "你好", "hello"),
      globalCard("week-6", "b", "谢谢", "thanks"),
      globalCard("week-9", "c", "秘密", "secret"),
      globalCard("week-7", "d", "旧", "old"),
      { PK: "USER#user-a", SK: "HIDDEN#GLOBAL#week-6#CARD#b", hidden: true },
      {
        PK: "USER#user-a",
        SK: "PRACTICE_GROUP#g1",
        name: "Final",
        deckIds: ["week-6", "week-9", "week-7", "deleted-deck"],
        createdAt: at,
        updatedAt: at,
      },
    ]);
    const before = JSON.stringify([...items.entries()]);
    mocks.session.mockResolvedValue(learnerA);
    const { loadCramSet } = await import("@/lib/cram-set");
    const set = await loadCramSet("g1");
    expect(set?.decks.map((d) => d.id)).toEqual(["week-6"]);
    expect(set?.missing).toBe(3);
    expect(set?.cards.map((c) => c.prompt)).toEqual(["你好"]);
    expect(JSON.stringify(set)).not.toContain("秘密");
    const writes = mocks.send.mock.calls.filter(([command]) => command.constructor.name !== "GetCommand" &&
      command.constructor.name !== "QueryCommand");
    expect(writes).toEqual([]);
    expect(JSON.stringify([...items.entries()])).toBe(before);
  });
});

describe("learner page guard", () => {
  it("sends the admin home and signed-out visitors to login", async () => {
    const redirect = vi.fn((url: string) => { throw new Error(`redirect:${url}`); });
    vi.doMock("next/navigation", () => ({ redirect }));
    const { requireLearnerPage } = await import("@/lib/guards");
    mocks.session.mockResolvedValue(admin);
    await expect(requireLearnerPage()).rejects.toThrow("redirect:/?adminStudy=1");
    mocks.session.mockResolvedValue(null);
    await expect(requireLearnerPage()).rejects.toThrow("redirect:/login");
    mocks.session.mockResolvedValue(learnerA);
    await expect(requireLearnerPage()).resolves.toBeUndefined();
  });
});
