import { HANDOFF_ID } from "./pwa-handoff";

const OAUTH_COOKIE = /^(?:__Host-|__Secure-)?authjs\./;
const AUTH_ERROR = /^[A-Za-z0-9_-]{1,64}$/;

/** Browser-stored cookie value. Auth.js percent-encodes Set-Cookie values. */
export function readSetCookie(header: string): { name: string; value: string; clear: boolean } | null {
  const parts = header.split(";").map((part) => part.trim());
  const [pair, ...attrs] = parts;
  if (!pair) return null;
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  if (!name) return null;
  let value = pair.slice(eq + 1).trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  const clear = value === "" || attrs.some((attr) => /^max-age=0$/i.test(attr));
  return { name, value, clear };
}

export function applySetCookies(jar: Map<string, string>, headers: string[]): void {
  for (const header of headers) {
    const cookie = readSetCookie(header);
    if (!cookie || !OAUTH_COOKIE.test(cookie.name)) continue;
    if (cookie.clear) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || jar.has(name)) continue;
    jar.set(name, value);
  }
  return jar;
}

export function serializeCookieHeader(jar: Map<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Saved flow cookies replace any stale copy. Auth.js keeps the first occurrence of a name. */
export function overlayOAuthCookies(existing: string | null, saved: { name: string; value: string }[]): string {
  const jar = parseCookieHeader(existing);
  for (const cookie of saved) {
    if (!OAUTH_COOKIE.test(cookie.name) || cookie.value.length > 4096) continue;
    jar.delete(cookie.name);
  }
  const ordered = new Map<string, string>();
  for (const cookie of saved) {
    if (!OAUTH_COOKIE.test(cookie.name) || cookie.value.length > 4096) continue;
    ordered.set(cookie.name, cookie.value);
  }
  for (const [name, value] of jar) ordered.set(name, value);
  return serializeCookieHeader(ordered);
}

export function oauthStateFromLocation(location: string): string | null {
  try {
    const state = new URL(location).searchParams.get("state");
    if (!state || state.length < 20 || state.length > 4096) return null;
    return state;
  } catch {
    return null;
  }
}

export function isGoogleCallbackPath(pathname: string): boolean {
  return pathname === "/api/auth/callback/google" || pathname.endsWith("/api/auth/callback/google");
}

/**
 * Auth.js sends OAuth failures to `/login`. During a Home Screen handoff that
 * page would offer the normal button and finish inside Safari. Send the sheet
 * back to the handoff screen instead.
 */
export function rewritePwaAuthError(response: Response, handoffId: string): Response {
  if (!HANDOFF_ID.test(handoffId)) return response;
  const location = response.headers.get("location");
  if (!location || response.status < 300 || response.status >= 400) return response;
  let target: URL;
  try {
    target = new URL(location);
  } catch {
    return response;
  }
  if (target.pathname !== "/login") return response;
  const error = target.searchParams.get("error");
  if (!error || !AUTH_ERROR.test(error)) return response;
  target.pathname = "/login/pwa-return";
  target.search = "";
  target.searchParams.set("handoff", handoffId);
  target.searchParams.set("error", error);
  const headers = new Headers(response.headers);
  headers.set("location", target.toString());
  return new Response(null, { status: response.status, statusText: response.statusText, headers });
}

export function withCookieHeader(request: Request, cookie: string): Request {
  const headers = new Headers(request.headers);
  if (cookie) headers.set("cookie", cookie);
  else headers.delete("cookie");
  return new Request(request.url, { method: request.method, headers, redirect: "manual" });
}
