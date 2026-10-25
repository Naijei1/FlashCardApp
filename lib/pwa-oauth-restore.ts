import { dynamoPwaAuthStore } from "./pwa-handoff-db";
import { hashOAuthState, type PwaAuthStore } from "./pwa-handoff";
import { isGoogleCallbackPath, overlayOAuthCookies, withCookieHeader } from "./pwa-oauth-state";

export type RestoredAuthRequest = { request: Request; handoffId: string | null };

/**
 * If this Google callback belongs to a Home Screen handoff, put the PKCE and
 * state cookies back on the request. A normal browser already has them; the
 * overlay replaces a stale copy with the jar from the sign-in that minted `state`.
 */
export async function restorePwaOAuthRequest(
  request: Request,
  now = Date.now(),
  store: PwaAuthStore = dynamoPwaAuthStore
): Promise<RestoredAuthRequest> {
  const url = new URL(request.url);
  if (!isGoogleCallbackPath(url.pathname)) return { request, handoffId: null };
  const state = url.searchParams.get("state");
  if (!state) return { request, handoffId: null };
  const bundle = await store.takeOAuth(hashOAuthState(state), now);
  if (!bundle) return { request, handoffId: null };
  const cookie = overlayOAuthCookies(request.headers.get("cookie"), bundle.cookies);
  return { request: withCookieHeader(request, cookie), handoffId: bundle.handoffId };
}
