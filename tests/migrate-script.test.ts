import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("migrate:multi-user entrypoint", () => {
  it("loads through the npm script without a top-level await crash", () => {
    const env = { ...process.env };
    delete env.TABLE_NAME;
    delete env.DYNAMODB_ENDPOINT;
    delete env.MIGRATION_ALLOW_PRODUCTION;
    delete env.MIGRATION_ALLOW_REMOTE;
    let output = "";
    let status = 0;
    try {
      output = execFileSync("npm", ["run", "migrate:multi-user"], {
        cwd: process.cwd(),
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      status = failed.status ?? 1;
      output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    }
    expect(output).not.toMatch(/Top-level await/);
    expect(output).toMatch(/TABLE_NAME is not set/);
    expect(status).toBe(1);
  });
});
