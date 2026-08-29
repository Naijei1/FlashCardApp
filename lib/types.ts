export type Deck = {
  id: string;
  name: string;
  /** BCP-47 tag used to pick a speech voice for the front side, e.g. "zh-CN" */
  frontLanguage?: string;
  backLanguage?: string;
  createdAt: string;
  updatedAt: string;
};

/** FSRS card state, JSON-safe (dates as ISO strings). */
export type StoredFsrs = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
};

export type Card = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  fsrs: StoredFsrs;
};

export type DeckCounts = {
  total: number;
  due: number;
  newCards: number;
};
