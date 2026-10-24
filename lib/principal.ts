export type Role = "admin" | "user";

export type AppSession = {
  userId: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  authMode: "shared" | "google";
};

export function accountIdentity(session: Pick<AppSession, "email" | "role" | "authMode">): {
  email: string;
  roleLabel: string;
  detail: string;
} {
  const email = session.email.trim() || (session.authMode === "shared" ? "Shared password" : "Signed in");
  if (session.role === "admin") {
    return {
      email,
      roleLabel: "Admin",
      detail: "Manages shared decks and learner totals. This account does not study.",
    };
  }
  return {
    email,
    roleLabel: "Learner",
    detail: session.authMode === "google"
      ? "Studies on this Google account. Progress stays with this sign-in."
      : "Studies on the shared password.",
  };
}
