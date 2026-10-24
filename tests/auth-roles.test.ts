import { afterEach, describe, expect, it } from "vitest";
import {
  googleAuthKey,
  planAccountLink,
  roleForVerifiedEmail,
} from "@/lib/multi-user-model";

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("admin role", () => {
  it("grants admin only when Google reports the email verified", () => {
    expect(roleForVerifiedEmail("Admin@Example.com", true)).toBe("user");
    process.env.ADMIN_EMAILS = "Admin@Example.com, other@example.com";
    expect(roleForVerifiedEmail("admin@example.com", true)).toBe("admin");
    expect(roleForVerifiedEmail("admin@example.com", false)).toBe("user");
    expect(roleForVerifiedEmail("learner@example.com", true)).toBe("user");
    delete process.env.ADMIN_EMAILS;
  });
});

describe("account linking", () => {
  const allow = ["admin@example.com"];

  it("rejects an unverified allowlisted email", () => {
    expect(
      planAccountLink({
        sub: "google-sub-1",
        email: "admin@example.com",
        emailVerified: false,
        adminAllowlist: allow,
      })
    ).toEqual({ action: "reject", reason: "unverified-email" });
  });

  it("uses the Google subject link instead of the email", () => {
    const plan = planAccountLink({
      sub: "google-sub-1",
      email: "naijeiwow@gmail.com",
      emailVerified: true,
      adminAllowlist: allow,
      existingLinkUserId: "user_existing",
      claim: { userId: "user_legacy_owner" },
    });
    expect(plan).toEqual({ action: "existing", userId: "user_existing", role: "user" });
    expect(googleAuthKey("google-sub-1").PK).toBe("AUTH#google#google-sub-1");
    expect(googleAuthKey("google-sub-1").PK).not.toContain("@");
  });

  it("claims the migrated placeholder once, then will not give it to another subject", () => {
    expect(
      planAccountLink({
        sub: "google-sub-1",
        email: "naijeiwow@gmail.com",
        emailVerified: true,
        adminAllowlist: allow,
        claim: { userId: "user_legacy_owner" },
      })
    ).toEqual({ action: "claim", userId: "user_legacy_owner", role: "user" });

    const taken = planAccountLink({
      sub: "other-sub",
      email: "naijeiwow@gmail.com",
      emailVerified: true,
      adminAllowlist: allow,
      claim: { userId: "user_legacy_owner", claimedSub: "google-sub-1" },
    });
    expect(taken.action).toBe("create");
    if (taken.action === "create") expect(taken.role).toBe("user");
  });

  it("makes a verified allowlisted email an admin on a new account", () => {
    expect(
      planAccountLink({
        sub: "admin-sub",
        email: "admin@example.com",
        emailVerified: true,
        adminAllowlist: allow,
      })
    ).toEqual({ action: "create", role: "admin" });
  });
});
