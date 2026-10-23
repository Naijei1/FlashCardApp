/** Shared by server auth code. Keep this file dependency-free. */
export const SESSION_COOKIE = "session";

/** HttpOnly session lifetime. Revocation is checked server-side before this expires. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Principal for the shared-password deployment. Multi-user migration should
 * map this id onto Naijei's regular user (see docs/multi-user-design.md).
 */
export const SHARED_USER_ID = "shared";
