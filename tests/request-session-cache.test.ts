import { expect, it, vi } from "vitest";
import { getAppSession } from "@/lib/app-session";
import { requireLearnerPage } from "@/lib/guards";
import { requireSession } from "@/lib/session";

const { isAuthenticated, serverReact } = await vi.hoisted(async () => {
  const { createRequire } = await import("node:module");
  // Vitest loads client React. Use the actual React cache Next uses for RSCs.
  const require = createRequire(`${process.cwd()}/package.json`);
  const serverReact = require("next/dist/compiled/react/cjs/react.react-server.development.js") as {
    cache: typeof import("react").cache;
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      A: { getCacheForType<T>(factory: () => T): T } | null;
    };
  };
  return { isAuthenticated: vi.fn(), serverReact };
});
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), cache: serverReact.cache }));
vi.mock("@/lib/auth", () => ({ isAuthenticated }));

async function renderRequest<T>(render: () => Promise<T>): Promise<T> {
  const internals = serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.A;
  const resources = new Map<() => unknown, unknown>();
  internals.A = {
    getCacheForType<T>(factory: () => T): T {
      if (!resources.has(factory)) resources.set(factory, factory());
      return resources.get(factory) as T;
    },
  };
  try {
    return await render();
  } finally {
    internals.A = previous;
  }
}

it("shares one lookup across helpers within a request and reads again on a later request", async () => {
  isAuthenticated.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await renderRequest(async () => {
    const [session, required] = await Promise.all([getAppSession(), requireSession(), requireLearnerPage()]);
    expect(session?.userId).toBe("shared");
    expect(required).toBe(session);
    expect(isAuthenticated).toHaveBeenCalledTimes(1);
  });
  expect(await renderRequest(getAppSession)).toBeNull();
  expect(isAuthenticated).toHaveBeenCalledTimes(2);
});
