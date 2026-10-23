export type AuthMode = "shared" | "google";
export type DataMode = "legacy" | "multi-user";

/** Shared password until Google OAuth is configured. `google` replaces it. */
export function authMode(): AuthMode {
  return process.env.AUTH_MODE === "google" ? "google" : "shared";
}

/**
 * Old card-item reads stay on unless this is `multi-user`.
 * Set `DATA_MODE=legacy` (or unset it) to roll reads back without deleting
 * migrated rows.
 */
export function dataMode(): DataMode {
  return process.env.DATA_MODE === "multi-user" ? "multi-user" : "legacy";
}

export function usesMultiUserData(): boolean {
  return dataMode() === "multi-user";
}
