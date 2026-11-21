import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { refusal, serveBackend } from "@/test-support/backend";

/** How many drains the client asked for behind the response. */
let drains = 0;

/** The status the backend answers every call with, which a case sets. */
let status = 200;

// Every call answered at the case's status with a refusal's coded body: each case holds the client's own reading of
// it, whichever endpoint it calls.
const backend = serveBackend(() => refusal("duplicate_key", { status }));
// Next's `after`, recording rather than running what the client schedules behind the response: the real
// `src/core/afterResponse.ts :: drainSoon` schedules each drain through it, and nothing else here does.
vi.doMock("next/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  after: () => {
    drains += 1;
  },
}));

const { FETCH_TIMEOUT_MS, PASS_FETCH_TIMEOUT_MS, sendToBackend } = await import("./api");
const { requestWriteMayStand, runInBackground, runWithRequestScope } = await import("./requestScope");
const { systemKeyPassTransport, systemKeyTransport } = await import("./transport");
const { saisonsGetTabelle } = await import("./generated/client/sdk");

/** The pass's bound as the backend's deadline counts it; the backend's own tests hold the deadline's half. */
const PASS_BOUNDS = z
  .strictObject({ pass_fetch_timeout_ms: z.number() })
  .parse(
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "tests", "shared", "pass_bounds.json"), "utf8")),
  );

beforeEach(() => {
  drains = 0;
  status = 200;
});

/* A pass sent under the other calls' bound is aborted at 15 s while the backend takes its rows for a minute, its writes
   landing after the scheduler reported the pass failed; a bound raised here alone lets the backend's deadline pass it. */
it("bounds a pass's call by the pass's bound and every other call by its own", async () => {
  const bounds = vi.spyOn(AbortSignal, "timeout");

  await systemKeyPassTransport("/api/identity/erasure/sweep", { method: "POST" });
  await systemKeyTransport("/api/outbox/handout", { method: "POST" });

  expect(bounds.mock.calls.map(([ms]) => ms)).toStrictEqual([PASS_FETCH_TIMEOUT_MS, FETCH_TIMEOUT_MS]);
  expect(PASS_FETCH_TIMEOUT_MS).toBe(PASS_BOUNDS.pass_fetch_timeout_ms);
});

/* `new URL` resolves `..` before any check runs, so an id spelling it would aim an authenticated call at another
   resource with nothing failing. */
it("refuses an endpoint the URL parser rewrote, sending nothing", async () => {
  await expect(sendToBackend("/bewerbungen/../teams", { authType: "base" })).rejects.toThrow("does not address");
  expect(backend.sent).toStrictEqual([]);
});

/* `isPathAsSpelled` cannot see an id carrying a plain `/`: it survives parsing untouched and reads as a nested endpoint,
   so the generated path builder percent-encodes every parameter before the client sees it. */
it("keeps an id carrying a slash one path segment, by the generator's `urlEncodeParameters`", async () => {
  await saisonsGetTabelle("2027/teams");

  expect(backend.sent.map(({ path }) => path)).toStrictEqual(["/saisons/2027%2Fteams/tabelle"]);
});

/* Every mail a write owes is written in that write's own transaction, so a write that asks for no drain leaves its mail
   to the hourly pass, up to an hour late, with nothing failing. */
it("drains behind every write that landed, and behind nothing else", async () => {
  await sendToBackend("/spielorte", { authType: "base", method: "POST", body: "{}" });
  expect(drains, "a landed write asked for no drain").toBe(1);

  await sendToBackend("/spielorte", { authType: "base" });
  await sendToBackend("/action_log/view", { authType: "base", method: "POST", body: "{}", readOnly: true });
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
