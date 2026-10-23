import { afterEach, describe, expect, it } from "vitest";
import { clearStudyQueueCache, readStudyQueue, rememberStudyQueue, reviewQueueUrl } from "@/components/studyQueueCache";

afterEach(() => clearStudyQueueCache());

describe("study queue cache", () => {
  it("serves a warmed queue once, then makes the next open fetch again", () => {
    const url = reviewQueueUrl("all", "review");
    rememberStudyQueue(url, { queue: [{ card: { id: "1" } }], totalDue: 1 });
    expect(readStudyQueue(url)).toEqual({ queue: [{ card: { id: "1" } }], totalDue: 1 });
    expect(readStudyQueue(url)).toBeNull();
  });

  it("drops a queue that sat longer than the warm window", () => {
    const url = reviewQueueUrl("deck", "write");
    rememberStudyQueue(url, { queue: [] });
    expect(readStudyQueue(url, Date.now() + 20_000)).toBeNull();
  });
});
