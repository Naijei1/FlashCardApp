import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signSession, SESSION_COOKIE } from "@/lib/auth";
import { middleware } from "@/middleware";

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

  it("uses the same encoded secret for server sessions and login redirects", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    vi.stubEnv("SESSION_SECRET_HEX", Buffer.from('session"\\$#\u5bc6'.repeat(4)).toString("hex"));
    const token = await signSession();
    const request = new NextRequest("https://example.com/login", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const response = await middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/");
  });
});
