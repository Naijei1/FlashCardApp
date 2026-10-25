import { pinyin } from "pinyin-pro";
import { AccessError } from "./access-error";
import { characterGloss, type CharacterRadical } from "./char-dict";
import { getAppSession } from "./app-session";
import {
  queryCharacterEntries,
  queryPartition,
  warmCharacterIndexes,
} from "./character-index";
import {
  selectLookupWords,
  type IndexScope,
  type IndexedCard,
  type LookupWord,
} from "./characters";
import { listAllCards, listDecks } from "./db";
import { usesMultiUserData } from "./flags";
import type { AppSession } from "./principal";

const WARM_BUDGET_MS = 2_500;

export type CharacterLookup = {
  character: string;
  pinyin?: string;
  gloss?: string;
  radical?: CharacterRadical;
  words: LookupWord[];
  total: number;
  truncated: boolean;
};

/** Gloss and radical from the offline dictionary, plus a reading when pinyin-pro has one. */
export function characterDetails(character: string): Pick<CharacterLookup, "pinyin" | "gloss" | "radical"> {
  let gloss: string | undefined;
  let radical: CharacterRadical | undefined;
  try {
    const entry = characterGloss(character);
    gloss = entry?.gloss;
    radical = entry?.radical;
  } catch (error) {
    console.warn("Character dictionary lookup failed", {
      name: error instanceof Error ? error.name : "error",
    });
  }
  const reading = readingForHeadword(character);
  return {
    ...(reading ? { pinyin: reading } : {}),
    ...(gloss ? { gloss } : {}),
    ...(radical ? { radical } : {}),
  };
}

export function readingForHeadword(hanzi: string): string | undefined {
  try {
    const syllables = pinyin(hanzi, {
      type: "string",
      toneType: "symbol",
      nonZh: "removed",
      toneSandhi: false,
      traditional: true,
    });
    const text = syllables.trim();
    if (!text || text === hanzi) return undefined;
    return text;
  } catch {
    return undefined;
  }
}

function withReadings(words: LookupWord[]): LookupWord[] {
  return words.map((word) => {
    const reading = readingForHeadword(word.hanzi);
    return reading ? { ...word, pinyin: reading } : word;
  });
}

function scopesFor(session: AppSession): IndexScope[] {
  if (!usesMultiUserData()) return [{ kind: "legacy" }];
  if (session.role === "admin") return [{ kind: "global" }];
  return [{ kind: "global" }, { kind: "private", userId: session.userId }];
}

async function hiddenCardKeys(userId: string): Promise<Set<string>> {
  const items = await queryPartition(`USER#${userId}`, "HIDDEN#GLOBAL#", true);
  const hidden = new Set<string>();
  for (const item of items) {
    const marker = typeof item.SK === "string" ? item.SK : "";
    const split = marker.split("#CARD#");
    if (split.length !== 2 || !split[1]) continue;
    const deckId = split[0].slice("HIDDEN#GLOBAL#".length);
    if (!deckId) continue;
    hidden.add(`${deckId}#${split[1]}`);
  }
  return hidden;
}

function finish(character: string, cards: readonly IndexedCard[], exclude?: { deckId: string; cardId: string }): CharacterLookup {
  const selected = selectLookupWords(cards, character, { exclude, limit: 100 });
  return {
    character,
    ...characterDetails(character),
    words: withReadings(selected.words),
    total: selected.total,
    truncated: selected.total > selected.words.length,
  };
}

/**
 * Words the signed-in learner can already open. The character index is filled
 * in the background of this call; until it covers every existing deck, lookup
 * reads the same visible card list as Browse.
 */
export async function lookupCharacter(
  character: string,
  exclude?: { deckId: string; cardId: string }
): Promise<CharacterLookup> {
  const session = await getAppSession();
  if (!session) throw new AccessError(401, "unauthorized");
  const scopes = scopesFor(session);
  let ready = false;
  try {
    ready = await warmCharacterIndexes(scopes, WARM_BUDGET_MS);
  } catch (error) {
    console.warn("Character index warm failed", {
      name: error instanceof Error ? error.name : "error",
    });
  }
  if (!ready) {
    const cards = await listAllCards();
    return finish(
      character,
      cards.map((card) => ({ deckId: card.deckId, cardId: card.id, front: card.front, back: card.back })),
      exclude
    );
  }
  const [entries, decks, hidden] = await Promise.all([
    Promise.all(scopes.map((scope) => queryCharacterEntries(scope, character))).then((groups) => groups.flat()),
    listDecks(),
    usesMultiUserData() && session.role !== "admin" ? hiddenCardKeys(session.userId) : Promise.resolve(new Set<string>()),
  ]);
  const visible = new Set(decks.map((deck) => deck.id));
  const cards = entries.filter((entry) => visible.has(entry.deckId) && !hidden.has(`${entry.deckId}#${entry.cardId}`));
  return finish(character, cards, exclude);
}
