import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { expect, it } from "vitest";
import { dynamic, GET, HEAD } from "@/app/api/health/route";
import { config } from "@/middleware";

it("serves uncached health checks without a session or middleware", async () => {
  expect(dynamic).toBe("force-dynamic");
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/health" })).toBe(false);

  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body).toEqual({ ok: true, time: new Date(body.time).toISOString() });

  const head = HEAD();
  expect(head.status).toBe(200);
  expect(head.headers.get("Cache-Control")).toBe("no-store");
  expect(await head.text()).toBe("");
});
