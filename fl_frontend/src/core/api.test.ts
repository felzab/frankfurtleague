import { beforeEach, expect, it, vi } from "vitest";

/** How many drains the client asked for behind the response. */
let drains = 0;

/** The status the backend answers every call with, which a case sets. */
let status = 200;

vi.doMock("@/core/config.ts", () => ({
  frontend_config: { API_URL: "http://backend.invalid" },
  internalApiKeyBase: () => "base-key-double",
  internalApiKeySystem: () => "system-key-double",
  internalApiKeyAdmin: () => "admin-key-double",
}));
vi.doMock("@/core/afterResponse.ts", () => ({
  drainSoon: () => {
    drains += 1;
  },
}));

const { sendToBackend } = await import("./api.ts");
const { requestWriteMayStand, runInBackground, runWithRequestScope } = await import("./requestScope.ts");

beforeEach(() => {
  drains = 0;
  status = 200;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error_code: "duplicate_key" }, { status: status }));
});

/* Every mail a write owes is written in that write's own transaction, so a write that asks for no drain leaves its mail
   to the hourly pass, up to an hour late, with nothing failing. */
it("drains behind every write that landed, and behind nothing else", async () => {
  await sendToBackend("/spielorte", { authType: "base", method: "POST", body: "{}" });
  expect(drains, "a landed write asked for no drain").toBe(1);

  await sendToBackend("/spielorte", { authType: "base" });
  await sendToBackend("/address_change/view", { authType: "base", method: "POST", body: "{}", readOnly: true });
  status = 409;
  await expect(sendToBackend("/spielorte", { authType: "base", method: "POST", body: "{}" })).rejects.toThrow();
  status = 200;
  // The drain's own claim and report, and every scheduler job's write: the pass drains last.
  await runInBackground("0".repeat(32), () => sendToBackend("/outbox/handout", { authType: "system", method: "POST" }));

  expect(drains, "a read, a refused write or a background pass's write asked for a drain").toBe(1);
});

/* The action builder clears the site's cache by this count: a refusal judged outside the dispatch would clear on every
   refused write, a guessed link's among them, and a 5xx taken for a refusal would leave a landed write's cache standing. */
it.each([
  [409, false],
  [500, true],
])("counts a write the backend answers with a coded %i as one that may stand: %s", async (answered, stands) => {
  status = answered;

  const counted = await runWithRequestScope({ traceId: "0".repeat(32) }, async () => {
    await sendToBackend("/spielorte", { authType: "base", method: "POST", body: "{}" }).catch(() => undefined);
    return requestWriteMayStand();
  });

  expect(counted).toBe(stands);
});
