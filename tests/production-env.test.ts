import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSessionClaims, signSession } from "@/lib/auth";

afterEach(() => vi.unstubAllEnvs());

describe("production environment", () => {
  it("preserves credential bytes through the writer and Next's real dotenv loader", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "flashcards-env-test-"));
    const password = 'abcdefghijkl"q\\z$NO_SUCH#tail\n\u5bc6\u7801';
    const secret = 'session"\\$#\n\u5bc6'.repeat(4);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      APP_PASSWORD: password,
      SESSION_SECRET: secret,
      TABLE_NAME: "test-table",
      APP_REGION: "us-east-1",
      APP_TIME_ZONE: "America/New_York",
    };
    try {
      execFileSync(process.execPath, [path.resolve("scripts/write-production-env.mjs")], {
        cwd: directory,
        env,
        stdio: "pipe",
      });
      // Use a clean child process so inherited plaintext values cannot mask a
      // serialization error in the generated production file.
      const result = execFileSync(process.execPath, ["-e", `
        const { loadEnvConfig } = require(${JSON.stringify(require.resolve("@next/env"))});
        delete process.env.APP_PASSWORD;
        delete process.env.SESSION_SECRET;
        delete process.env.APP_PASSWORD_HEX;
        delete process.env.SESSION_SECRET_HEX;
        delete process.env.__NEXT_PROCESSED_ENV;
        loadEnvConfig(process.cwd());
        process.stdout.write(JSON.stringify({
          password: Buffer.from(process.env.APP_PASSWORD_HEX, 'hex').toString('utf8'),
          secret: Buffer.from(process.env.SESSION_SECRET_HEX, 'hex').toString('utf8'),
          table: process.env.TABLE_NAME,
          timeZone: process.env.APP_TIME_ZONE,
        }));
      `], { cwd: directory, env, encoding: "utf8" });
      expect(JSON.parse(result)).toEqual({
        password,
        secret,
        table: "test-table",
        timeZone: "America/New_York",
      });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("uses the encoded secret for revocable server sessions", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("SESSION_SECRET_HEX", Buffer.from('session"\\$#\u5bc6'.repeat(4)).toString("hex"));
    const claims = {
      userId: "shared",
      sessionId: "session-id-123456",
      sessionVersion: 1,
    };
    expect(await readSessionClaims(await signSession(claims))).toEqual(claims);
  });

  it("hex-encodes Google OAuth secrets for a multi-user build", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "flashcards-env-test-"));
    const authSecret = 'auth"\\$#\n\u5bc6'.repeat(4);
    const googleSecret = "google-secret-value";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      AUTH_MODE: "google",
      DATA_MODE: "multi-user",
      AUTH_SECRET: authSecret,
      AUTH_GOOGLE_ID: "client.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: googleSecret,
      ADMIN_EMAILS: "admin@example.com",
      AUTH_URL: "https://main.d3otcaeyemrjvk.amplifyapp.com",
      TABLE_NAME: "test-table",
      APP_REGION: "us-east-1",
      APP_TIME_ZONE: "America/New_York",
    };
    delete env.APP_PASSWORD;
    delete env.SESSION_SECRET;
    try {
      execFileSync(process.execPath, [path.resolve("scripts/write-production-env.mjs")], {
        cwd: directory,
        env,
        stdio: "pipe",
      });
      const file = readFileSync(path.join(directory, ".env.production"), "utf8");
      expect(file).not.toContain(googleSecret);
      expect(file).not.toContain(authSecret);
      expect(file).toContain("AUTH_MODE=google");
      expect(file).toContain("DATA_MODE=multi-user");
      const result = execFileSync(process.execPath, ["-e", `
        const { loadEnvConfig } = require(${JSON.stringify(require.resolve("@next/env"))});
        delete process.env.AUTH_SECRET;
        delete process.env.AUTH_GOOGLE_SECRET;
        delete process.env.AUTH_SECRET_HEX;
        delete process.env.AUTH_GOOGLE_SECRET_HEX;
        delete process.env.__NEXT_PROCESSED_ENV;
        loadEnvConfig(process.cwd());
        process.stdout.write(JSON.stringify({
          authSecret: Buffer.from(process.env.AUTH_SECRET_HEX, "hex").toString("utf8"),
          googleSecret: Buffer.from(process.env.AUTH_GOOGLE_SECRET_HEX, "hex").toString("utf8"),
          clientId: process.env.AUTH_GOOGLE_ID,
          admins: process.env.ADMIN_EMAILS,
          url: process.env.AUTH_URL,
        }));
      `], { cwd: directory, env, encoding: "utf8" });
      expect(JSON.parse(result)).toEqual({
        authSecret,
        googleSecret,
        clientId: "client.apps.googleusercontent.com",
        admins: "admin@example.com",
        url: "https://main.d3otcaeyemrjvk.amplifyapp.com",
      });
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
