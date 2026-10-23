export type CardSource = "global" | "private";
export type DeckReleaseStatus = "draft" | "scheduled" | "published";

export type Deck = {
  id: string;
  name: string;
  /** BCP-47 tag used to pick a speech voice for the front side, e.g. "zh-CN" */
  frontLanguage?: string;
  backLanguage?: string;
  /** Which side holds Chinese for Write mode, when languages aren't set. */
  chineseSide?: "front" | "back";
  createdAt: string;
  updatedAt: string;
  source?: CardSource;
  /** Absent on legacy and migrated decks, which are already released. */
  status?: DeckReleaseStatus;
  /** Display label such as week 3. Visibility uses releaseAt, not a scheduler. */
  releaseWeek?: number;
  releaseAt?: string;
  archivedAt?: string;
};

/** FSRS card state, JSON-safe (dates as ISO strings). */
export type StoredFsrs = {
  retentionTarget?: number;
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

export type ReviewMode = "review" | "write" | "pinyin";

export type Card = {
  id: string;
  deckId: string;
  front: string;
  back: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  fsrs: StoredFsrs;
  hard?: boolean;
  modes?: Partial<Record<"write" | "pinyin", { fsrs: StoredFsrs; practice?: Card["practice"] }>>;
  practice?: { failures: number; successes: number; correctStreak: number; firstStudiedAt?: string };
  source?: CardSource;
  contentVersion?: number;
};

export type DeckCounts = {
  total: number;
  due: number;
  newCards: number;
};
