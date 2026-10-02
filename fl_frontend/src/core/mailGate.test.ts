import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { inspect } from "node:util";

import { registerDoubles } from "./exportingModule.ts";

const API_ORIGIN = "http://backend.test";
const API_VERSION = 0;
const GATE_URL = `${API_ORIGIN}/api/v${String(API_VERSION)}/identitaet/gesperrt`;

const BARRED = "gerda.gesperrt@schule.de";

// The key names the real module reads, each a fabricated value: the gate's call is a system-tier one.
const CONFIG_DOUBLE = {
  frontend_config: {
    API_URL: API_ORIGIN,
    API_VERSION: API_VERSION,
    INTERNAL_API_KEY_BASE: "fabricated-base-not-a-credential",
    INTERNAL_API_KEY_SYSTEM: "fabricated-system-not-a-credential",
    INTERNAL_API_KEY_ADMIN: "fabricated-admin-not-a-credential",
  },
};

/** What the doubled logger was handed. `error` is the second argument, which must stay absent. */
type RecordedLine = { level: "info" | "warn" | "error"; message: string; error?: unknown; meta?: Record<string, unknown> };

const logs: RecordedLine[] = [];

const LOGGER_DOUBLE = {
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void logs.push({ level: "info", message, meta }),
    warn: (message: string, meta?: Record<string, unknown>) => void logs.push({ level: "warn", message, meta }),
    error: (message: string, error: unknown, meta?: Record<string, unknown>) => void logs.push({ level: "error", message, error, meta }),
  },
};

registerDoubles({ modules: { "core/config.ts": CONFIG_DOUBLE, "core/logging.ts": LOGGER_DOUBLE } });

const { mayReceiveMail } = await import("./mailGate.ts");
const { REQUEST_DEADLINE_MS, runWithRequestScope } = await import("./requestScope.ts");

/** Every request the gate drew, and how the backend answers the next. */
const asked: { url: string; init: RequestInit }[] = [];
let answer: (body: { email: string }) => Promise<Response>;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } });

/** The endpoint's own answer: barred exactly where the address is the one ban this backend holds. */
const theBackend = async ({ email }: { email: string }): Promise<Response> => json({ acknowledged: 1, gesperrt: email === BARRED }, 200);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  asked.push({ url: String(input), init: init ?? {} });

  return answer(JSON.parse(String(init?.body ?? "{}")) as { email: string });
}) as typeof fetch;

beforeEach(() => {
  asked.length = 0;
  logs.length = 0;
  answer = theBackend;
});

/** The line a failed read leaves, whatever failed. */
const failedLine = () => logs.filter((line) => line.message === "mail.gate_failed");

describe("the ban list's gate", () => {
  it("admits an address no ban holds, and writes no line", async () => {
    assert.equal(await mayReceiveMail("anmeldecode", "anna@schule.de"), "admitted");
    assert.deepEqual(logs, []);
  });

  it("bars an address a ban holds", async () => {
    assert.equal(await mayReceiveMail("bewerbung_zusage", BARRED), "barred");
  });

  /* A subject can name a school, and the address is the very thing a ban keeps off every line. */
  it("logs a barred message by its kind alone", async () => {
    await mayReceiveMail("einladung", BARRED);

    assert.deepEqual(logs, [{ level: "info", message: "mail.barred", meta: { art: "einladung" } }]);
  });

  /* In the body and on no query: a URL carrying an address reaches the edge's access line. Read-only
     and system tier, as the published operation declares it (`docs/backend/spec.md :: I543`). */
  it("asks the published question once, the address in the body alone", async () => {
    await mayReceiveMail("anmeldecode", "anna@schule.de");

    assert.equal(asked.length, 1);
    assert.equal(asked[0]!.url, GATE_URL);
    assert.equal(asked[0]!.init.method, "POST");
    assert.deepEqual(JSON.parse(String(asked[0]!.init.body)), { email: "anna@schule.de" });
    assert.equal(new Headers(asked[0]!.init.headers).get("Authorization"), "Bearer fabricated-system-not-a-credential");
  });

  /* Unread rather than read and overruled: the notice telling somebody they are barred neither waits
     on the list nor fails with it. */
  it("lets the ban's own notice through to a barred address without asking the list", async () => {
    answer = async () => assert.fail("the ban's own notice asked the list");

    assert.equal(await mayReceiveMail("sperre", BARRED), "admitted");
    assert.equal(asked.length, 0);
  });
});

describe("a ban list the gate cannot read", () => {
  /* Closed for every kind it reads for: a send past a failed read would defeat the ban. */
  for (const [what, fails] of [
    ["a broken connection", async (): Promise<Response> => Promise.reject(new TypeError("fetch failed"))],
    ["a server error", async (): Promise<Response> => json({ error_code: "DB-FAIL-001", trace_id: "0" }, 500)],
    ["an answer of another shape", async (): Promise<Response> => json({ acknowledged: 1 }, 200)],
  ] as const) {
    it(`fails closed on ${what}, under its own code and the error's name alone`, async () => {
      answer = fails;

      assert.equal(await mayReceiveMail("bewerbung_absage", BARRED), "failed");

      const [line, ...rest] = failedLine();
      assert.deepEqual(rest, []);
      assert.equal(line?.meta?.["error_code"], "FE-MAIL-012");
      assert.equal(line?.error, undefined);
      assert.ok(!inspect(line, { depth: null }).includes(BARRED), "the line carried the address");
    });
  }

  /* The request's deadline bounds the read as it bounds the send: a read refused unsent is a read
     that failed, and no message leaves past it (`docs/frontend/spec.md :: I366`). */
  it("fails closed where the request's deadline is spent, and says it timed out", async (t) => {
    const clock = performance.now();
    t.mock.method(performance, "now", () => clock);

    const verdict = await runWithRequestScope({ traceId: "a".repeat(32), spanId: "b".repeat(16) }, async () => {
      t.mock.method(performance, "now", () => clock + REQUEST_DEADLINE_MS);
      return mayReceiveMail("registrierung_erinnerung", BARRED);
    });

    assert.equal(verdict, "failed");
    assert.equal(asked.length, 0, "a read was drawn past the deadline");
    assert.equal(failedLine()[0]?.meta?.["is_timeout"], true);
  });
});
