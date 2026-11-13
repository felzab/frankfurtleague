import { AsyncLocalStorage } from "node:async_hooks";

import { configDouble } from "@/test-support/authDoubles.ts";
import { serveBackend, serveHost } from "@/test-support/backend.ts";
import { beforeEach, expect, it, vi } from "vitest";

import type { FLOutboxHandout } from "./generated/client/types.ts";

/**
 * The restore's hold, which a case sets, under the production deployment holding the provider's key: only that one
 * sends, and any other files its mail on disk.
 */
const CONFIG = configDouble({ APP_ENV: "production", RESTORE_HOLD: "off" }, { authResendKey: () => "re_fabricated-not-a-credential" });
const settings = CONFIG.frontend_config as { RESTORE_HOLD: string };

/**
 * Work handed to Next's `after`, collected rather than run, so a case runs it where it reads the outcome: bound to the
 * caller's async context, as Next's `after` binds it, so work scheduled inside a request starts inside its scope.
 */
const scheduled: (() => Promise<void>)[] = [];

/** `performance.now()`'s reading, which the hand-out moves past the request's own 30-second cut. */
let clock = 0;

/** One ban notice the Postausgang hands out. */
const MAIL: FLOutboxHandout = {
  id: "a".repeat(24),
  to: "person@example.org",
  data: { kind: "ban", ban_reason: "Grund", barred_until_saison_id: "2627" },
  token: null,
  secret: null,
  attempt: 1,
};

/** Whether the backend has handed `MAIL` out yet: once, the claim after it holding nothing. */
let handedOut = false;

// The hand-out takes 31 seconds, so every call the drain makes after it is past a request's cut.
const backend = serveBackend(({ method, path, body }) => {
  if (method === "POST" && path === "/outbox/handout") {
    clock += 31000;
    if (handedOut) return { lease: null, mails: [], abandoned: 0 };
    handedOut = true;
    return { lease: "claim-1", mails: [MAIL], abandoned: 0 };
  }
  if (method === "POST" && path === "/outbox/result") {
    const { result } = body as { result: string };
    return { sent: result === "sent" ? 1 : 0, repeated: result === "retry" ? 1 : 0, abandoned: 0, held: 0, ignored: 0 };
  }
  return undefined;
});
/** The provider's one endpoint, served inside the case reading what it took: a host the file serves records every case. */
const serveTheProvider = () =>
  serveHost("https://api.resend.com", ({ method, url }) => (method === "POST" && url.pathname === "/emails" ? { id: "re-1" } : undefined));

vi.doMock("@/core/config.ts", () => CONFIG);
vi.doMock("next/server", async () => ({
  ...(await vi.importActual<object>("next/server")),
  after: (task: () => Promise<void>) => void scheduled.push(AsyncLocalStorage.bind(task)),
}));

const { drainSoon } = await import("./afterResponse.ts");
const { runWithRequestScope } = await import("./requestScope.ts");

beforeEach(() => {
  scheduled.length = 0;
  clock = 0;
  handedOut = false;
  settings.RESTORE_HOLD = "off";
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

/* Under a restore's hold a write's mail would otherwise leave before the restore's steps are done: to somebody not yet
   erased again, or a second time for a mail the lost window sent. */
it("schedules no drain under a restore's hold, and one without it", () => {
  settings.RESTORE_HOLD = "on";
  drainSoon();
  expect(scheduled.length, "a held drain was scheduled").toBe(0);

  settings.RESTORE_HOLD = "off";
  drainSoon();
  expect(scheduled.length, "the case proves nothing: an unheld drain was not scheduled either").toBe(1);
});

/* A page of ten sends and reports runs far past a request's 30 seconds at the provider's worst; under that cut every
   send after it would be refused unsent and the page left to the hourly pass. Scheduled from inside a request, as a
   write's drain is, so a drain run in the request's scope would inherit its cut. */
it("drains behind the response under no request's cut, so a drain past 30 seconds still sends", async () => {
  const provided = serveTheProvider();
  await runWithRequestScope({ traceId: "0".repeat(32) }, async () => {
    drainSoon();
  });
  const [drain] = scheduled;
  expect(drain, "no drain was scheduled").toBeDefined();

  await drain?.();

  expect(
    provided.map(({ body }) => (body as { to?: unknown }).to),
    "the send after 31 seconds was cut",
  ).toStrictEqual([MAIL.to]);
  expect(backend.sent.map(({ path, body }) => [path, (body as { result?: unknown } | undefined)?.result])).toStrictEqual([
    ["/outbox/handout", undefined],
    ["/outbox/result", "sent"],
    ["/outbox/handout", undefined],
  ]);
});
