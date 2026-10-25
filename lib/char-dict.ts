import { CHAR_DICT_JSON } from "@/data/char-dict";

type DictFile = {
  radicals: Record<string, [string, string]>;
  chars: Record<string, [string, string]>;
};

export type CharacterRadical = {
  /** Kangxi radical number, 1 through 214. */
  number: number;
  character: string;
  meaning?: string;
};

export type CharacterGloss = {
  gloss?: string;
  radical?: CharacterRadical;
};

let parsed: DictFile | undefined;

function dictionary(): DictFile {
  parsed ??= JSON.parse(CHAR_DICT_JSON) as DictFile;
  return parsed;
}

function radicalFor(key: string): CharacterRadical | undefined {
  const base = /^(\d+)/.exec(key)?.[1];
  if (!base) return undefined;
  const number = Number(base);
  if (!Number.isInteger(number) || number < 1) return undefined;
  const row = dictionary().radicals[key] ?? dictionary().radicals[base];
  if (!row?.[0]) return undefined;
  const [character, meaning] = row;
  return {
    number,
    character,
    ...(meaning ? { meaning } : {}),
  };
}

/** English gloss and Kangxi radical for one ideograph, when the offline dictionary has them. */
export function characterGloss(character: string): CharacterGloss | undefined {
  if ([...character].length !== 1) return undefined;
  const row = dictionary().chars[character];
  if (!row) return undefined;
  const [gloss, key] = row;
  const radical = key ? radicalFor(key) : undefined;
  if (!gloss && !radical) return undefined;
  return {
    ...(gloss ? { gloss } : {}),
    ...(radical ? { radical } : {}),
  };
}
