import { describe, expect, it, vi } from "vitest";

import { logParams } from "./filters";

/** Every read's filters, as the Protokoll's next page asked them. */
const asked = vi.hoisted(() => [] as unknown[]);

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: async () => {
    (await import("@/core/requestScope")).setRequestActor({ email: "admin@example.org", lane: "admin", authTime: 0, factor: "passkey" });
    return { session: {} };
  },
  passesPasskeyTouch: async () => true,
}));
vi.mock("./queries", () => ({
  getActionLog: async (filters: unknown) => {
    asked.push(filters);
    return { action_log: [], by_options: [], cursor: null };
  },
}));

const { loadActionLog } = await import("./actions");

describe("the Protokoll's next page", () => {
  /* A page read past the filters runs on with rows the list above it left out, and only a long enough log shows it. */
  it("reads inside the filters the page carried", async () => {
    const carried = { by: "system", type: "ban", time: "30-days" } as const;
    const cursor = "a".repeat(24);

    expect(await loadActionLog({ ...carried, query: "Birke", cursor })).toStrictEqual({ ok: true, value: { rows: [], cursor: null } });

    expect(asked).toStrictEqual([{ ...logParams(carried), q: "Birke", cursor }]);
  });
});
