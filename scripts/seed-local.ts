import { loadEnvConfig } from "@next/env";
import { buildCards } from "../lib/cards";
import { emptyCardState, State } from "../lib/fsrs";
import type { Card } from "../lib/types";

loadEnvConfig(process.cwd());

const WORDS: Array<[string, string, string?]> = [
  ["你好", "hello", "greeting"],
  ["谢谢", "thank you"],
  ["老师", "teacher"],
  ["学生", "student"],
  ["中国", "China"],
  ["朋友", "friend"],
  ["水", "water"],
  ["吃", "to eat"],
  ["喝", "to drink"],
  ["看", "to look"],
  ["听", "to listen"],
  ["说", "to speak"],
  ["读", "to read"],
  ["写", "to write"],
  ["大", "big"],
  ["小", "small"],
  ["多", "many"],
  ["少", "few"],
  ["人", "person"],
  ["家", "home / family"],
  ["学校", "school"],
  ["书", "book"],
  ["字", "character"],
  ["今天", "today"],
  ["明天", "tomorrow"],
  ["昨天", "yesterday"],
  ["是", "to be"],
  ["有", "to have"],
  ["没有", "to not have"],
  ["很", "very"],
  ["太", "too"],
  ["不", "not"],
  ["也", "also"],
  ["和", "and"],
  ["的", "possessive particle"],
  ["了", "aspect particle"],
  ["在", "at / in"],
  ["去", "to go"],
  ["来", "to come"],
  ["回", "to return"],
  ["买", "to buy"],
  ["卖", "to sell"],
  ["钱", "money"],
  ["时间", "time"],
  ["年", "year"],
  ["月", "month"],
  ["日", "day"],
  ["点", "o'clock"],
  ["分", "minute"],
  ["现在", "now"],
  ["喜欢", "to like"],
  ["爱", "to love"],
  ["想", "to want / to think"],
  ["觉得", "to feel / think"],
  ["知道", "to know"],
  ["认识", "to be acquainted with"],
  ["可以", "can / may"],
  ["能", "to be able to"],
  ["会", "to know how to"],
  ["请", "please"],
  ["对不起", "sorry"],
  ["没关系", "it's alright"],
];

function clinicWeakCards(now: Date): Card[] {
  const stamp = now.toISOString();
  const fresh = emptyCardState(now);
  const base = (id: string, front: string, back: string): Card => ({
    id,
    deckId: "e2e-lesson-1",
    front,
    back,
    createdAt: stamp,
    updatedAt: stamp,
    fsrs: fresh,
  });
  // Dedicated modes so the clinic queue is recognition → write → pinyin.
  // Review: lapses + relearning + failures ≈ 36–40. Write failures = 24. Pinyin failures = 15.
  return [
    {
      ...base("e2e-clinic-review", "忘记", "to forget"),
      fsrs: {
        ...fresh,
        reps: 6,
        lapses: 5,
        state: State.Relearning,
        last_review: stamp,
      },
      practice: {
        failures: 2,
        successes: 3,
        correctStreak: 0,
        firstStudiedAt: "2026-09-20T12:00:00.000Z",
      },
    },
    {
      ...base("e2e-clinic-write", "难", "difficult"),
      modes: {
        write: {
          fsrs: fresh,
          practice: {
            failures: 8,
            successes: 0,
            correctStreak: 0,
            firstStudiedAt: "2026-09-20T12:00:00.000Z",
          },
        },
      },
    },
    {
      ...base("e2e-clinic-pinyin", "学习", "to study"),
      modes: {
        pinyin: {
          fsrs: fresh,
          practice: {
            failures: 5,
            successes: 0,
            correctStreak: 0,
            firstStudiedAt: "2026-09-20T12:00:00.000Z",
          },
        },
      },
    },
  ];
}

async function main() {
  const { putDeck, batchPutCards, listDecks } = await import("../lib/db");
  const existing = await listDecks();
  const now = new Date("2026-10-08T12:00:00.000Z");
  if (existing.some((deck) => deck.id === "e2e-lesson-1")) {
    console.log("Seed data already present");
  } else {
    await putDeck(
      {
        id: "e2e-lesson-1",
        name: "E2E Lesson 1",
        frontLanguage: "zh-CN",
        backLanguage: "en-US",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      { create: true }
    );
    const cards = WORDS.flatMap(([front, back, notes], index) => {
      let copy = 0;
      return buildCards(
        {
          deckId: "e2e-lesson-1",
          front,
          back,
          notes,
          reverse: index % 17 === 0,
        },
        now,
        () => `e2e-card-${index}-${copy++}`
      );
    });
    await batchPutCards(cards);
    console.log(`Seeded ${cards.length} cards into E2E Lesson 1`);
  }
  const clinic = clinicWeakCards(now);
  await batchPutCards(clinic, { skipExisting: true });
  console.log(`Ensured ${clinic.length} Mistake Clinic weak cards`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
