import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** How long the Home Screen app can wait for the Safari sheet to finish. */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;
/** Matches the Auth.js PKCE / state cookie lifetime. */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
export const HANDOFF_CREATE_LIMIT = 20;
export const HANDOFF_CREATE_WINDOW_MS = 15 * 60 * 1000;

export const PWA_HANDOFF_COOKIE = "pwa-handoff";

const CONFIRM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** 16 bytes, unpadded base64url. */
export const HANDOFF_ID = /^[A-Za-z0-9_-]{22}$/;
/** 32 bytes, unpadded base64url. */
const HANDOFF_SECRET = /^[A-Za-z0-9_-]{43}$/;
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export type HandoffStatus = "pending" | "ready" | "claimed";

export type HandoffSession = {
  appUserId: string;
  email: string;
  sessionId: string;
  sessionVersion: number;
};

export type HandoffRecord = HandoffSession & {
  id: string;
  secretHash: string;
  confirmCode: string;
  status: HandoffStatus;
  expiresAt: number;
};

export type OAuthCookie = { name: string; value: string };

export type OAuthBundle = {
  stateHash: string;
  handoffId: string;
  cookies: OAuthCookie[];
  expiresAt: number;
};

export type CreateWindow = { count: number; windowStartedAt: number };

export function createHandoffId(): string {
  return randomBytes(16).toString("base64url");
}

export function createHandoffSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Visual check only. The HttpOnly secret is what authorizes the claim. */
export function createConfirmCode(): string {
  const bytes = randomBytes(4);
  let code = "";
  for (const byte of bytes) code += CONFIRM_ALPHABET[byte % CONFIRM_ALPHABET.length];
  return code;
}

export function hashHandoffSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export function handoffSecretsMatch(secret: string, secretHash: string): boolean {
  const actual = Buffer.from(hashHandoffSecret(secret));
  const expected = Buffer.from(secretHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function sealHandoffCookie(id: string, secret: string): string {
  return `${id}.${secret}`;
}

export function openHandoffCookie(value: string | undefined | null): { id: string; secret: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!HANDOFF_ID.test(id) || !HANDOFF_SECRET.test(secret)) return null;
  return { id, secret };
}

export function handoffIsCurrent(record: { expiresAt: number; status: HandoffStatus } | null, now: number): boolean {
  return !!record && record.expiresAt > now && record.status !== "claimed";
}

export function validHandoffSession(session: HandoffSession): boolean {
  if (!USER_ID.test(session.appUserId) || !SESSION_ID.test(session.sessionId)) return false;
  if (!Number.isSafeInteger(session.sessionVersion) || session.sessionVersion < 1) return false;
  const email = session.email.trim();
  if (!email || email.length > 320 || /[\r\n]/.test(email)) return false;
  return true;
}

/**
 * New Home Screen installs can refresh the login page. Allow a burst, then
 * refuse, so a script cannot fill the handoff partition.
 */
export function nextCreateWindow(current: CreateWindow | null, now: number): CreateWindow | "blocked" {
  const fresh = !current || now - current.windowStartedAt >= HANDOFF_CREATE_WINDOW_MS;
  if (!fresh && current.count >= HANDOFF_CREATE_LIMIT) return "blocked";
  return {
    count: fresh ? 1 : current.count + 1,
    windowStartedAt: fresh ? now : current.windowStartedAt,
  };
}

export type PwaAuthStore = {
  saveHandoff(record: HandoffRecord): Promise<void>;
  readHandoff(id: string): Promise<HandoffRecord | null>;
  markReady(id: string, session: HandoffSession, now: number): Promise<boolean>;
  markClaimed(id: string, now: number): Promise<boolean>;
  saveOAuth(bundle: OAuthBundle): Promise<void>;
  takeOAuth(stateHash: string, now: number): Promise<OAuthBundle | null>;
  readCreateWindow(key: string): Promise<CreateWindow | null>;
  saveCreateWindow(key: string, next: CreateWindow, expected: CreateWindow | "absent"): Promise<boolean>;
};

export async function reserveHandoffCreate(store: PwaAuthStore, key: string, now: number): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const current = await store.readCreateWindow(key);
    const next = nextCreateWindow(current, now);
    if (next === "blocked") return false;
    const expected = !current || now - current.windowStartedAt >= HANDOFF_CREATE_WINDOW_MS ? "absent" : current;
    if (expected === "absent" && current) {
      // The expired row is still there. Overwrite it by expecting those values.
      const saved = await store.saveCreateWindow(key, next, current);
      if (saved) return true;
      continue;
    }
    const saved = await store.saveCreateWindow(key, next, expected);
    if (saved) return true;
  }
  return false;
}

export function newHandoffRecord(now: number): { record: HandoffRecord; secret: string } {
  const secret = createHandoffSecret();
  const record: HandoffRecord = {
    id: createHandoffId(),
    secretHash: hashHandoffSecret(secret),
    confirmCode: createConfirmCode(),
    status: "pending",
    expiresAt: now + HANDOFF_TTL_MS,
    appUserId: "",
    email: "",
    sessionId: "",
    sessionVersion: 0,
  };
  return { record, secret };
}

/**
 * The Safari sheet never receives the Home Screen cookie. A matching cookie
 * means Google finished inside the installed app, so the session cookie Auth.js
 * just set is already in the right jar.
 */
export function depositCanClaim(cookie: { id: string; secret: string } | null, handoffId: string, secretHash: string): boolean {
  if (!cookie || cookie.id !== handoffId) return false;
  return handoffSecretsMatch(cookie.secret, secretHash);
}
