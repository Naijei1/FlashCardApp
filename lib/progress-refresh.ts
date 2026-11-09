/**
 * Home, deck, and stats counts are server-rendered. Review saves go through
 * `/api/review`, which does not clear the Next.js client router cache, so back
 * navigation and a resumed PWA keep the previous payload until a full reload.
 * These helpers decide when a summary screen should refresh without touching
 * an open study session.
 */

/** Collapse resume events and a burst of saved reviews into one refresh. */
export const REFRESH_COALESCE_MS = 300;

/** A second focus/visibility refresh this soon after the last one adds no new read. */
export const RESUME_REFRESH_GAP_MS = 1000;

/** Routes whose client state is the study position. Refreshing them jumps the card. */
export function isStudyRoute(pathname: string): boolean {
  return (
    pathname === "/clinic" ||
    pathname.startsWith("/clinic/") ||
    pathname.startsWith("/study/") ||
    pathname.startsWith("/review/") ||
    pathname.startsWith("/write/") ||
    pathname.startsWith("/pinyin/")
  );
}
