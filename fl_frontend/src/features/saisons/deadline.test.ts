import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleActionRequest, loggedLines } from "@/shared/testing/actionDoubles.ts";
import { saisonRules } from "@/shared/testing/saisonRules.ts";

/* The real action, client and request scope, only their network doubled below: what is driven is the deadline
   cutting one deletion call inside the activation press, which a doubled client would have to restage. */
const API_URL = "http://backend:8000";

const CONFIG = {
  frontend_config: {
    API_URL: API_URL,
    API_VERSION: 0,
    APP_ENV: "production",
    AUTH_URL: "https://liga.example.de",
    LOESCHUNG_SWEEP: "on",
  },
  internalApiKeyBase: () => "base-key-double",
  internalApiKeySystem: () => "system-key-double",
  internalApiKeyAdmin: () => "admin-key-double",
};

doubleActionRequest();

registerDoubles({
  modules: {
    "core/config.ts": CONFIG,
  },
});

const { activateSaisonAction } = await import("./actions.ts");
const { REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

const SAISON_ID = "2026";

/** How long the activation and the first deletion call each take: inside a call's own bound, and two of them past its length short of the deadline. */
const CALL_MS = 10000;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const AKTIVIERT = {
  acknowledged: 1,
  updated_document: {
    id: SAISON_ID,
    start_date: "2026-03-01",
    end_date: "2026-07-01",
    rules: saisonRules(),
    bewerbung: null,
    registrierung: null,
    status: "active",
    schedule: [],
    spielplan: null,
  },
  deactivated: 1,
};

const ERSTER_LAUF = {
  acknowledged: 1,
  abgeschlossene_saison_id: "2025",
  spieler: 2,
  saison_spieler: 3,
  registrierungen: 0,
  uebersprungen: 0,
  fehlgeschlagen: 0,
  verbleibend: 5,
  nach: `${"d".repeat(23)}4`,
};

/** Every call the press sent, with the signal that could abort it. */
const sent: { url: string; signal: AbortSignal }[] = [];

// Honours the signal as the real `fetch` does. The second deletion call never answers: only an abort ends it.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const signal = init?.signal ?? assert.fail("a call went out unbounded");
  sent.push({ url: url, signal: signal });
  if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });

  const antwort = url.endsWith("/activate") ? AKTIVIERT : sent.length === 2 ? ERSTER_LAUF : null;

  return await new Promise<Response>((resolve, reject) => {
    if (antwort !== null) setTimeout(() => resolve(json(antwort)), CALL_MS);
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
}) as typeof fetch;

/** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  mock.timers.tick(ms);
};

/** Bounded, so a press that stops short of the call fails naming it rather than spinning. */
async function untilCall(count: number): Promise<{ url: string; signal: AbortSignal }> {
  for (let turn = 0; turn < 1000 && sent.length < count; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return sent[count - 1] ?? assert.fail(`call ${String(count)} was never sent`);
}

beforeEach(() => {
  sent.length = 0;
  clock = 0;
  mock.method(performance, "now", () => clock);
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("an activation whose deletion the request's deadline cuts", () => {
  /* The activation was acknowledged before the deletion began, so only the deletion is in doubt: answered as of
     unknown outcome, the press sends the administrator to check a season change that stands. */
  it("answers the activation saved and the deletion unfinished, never as of unknown outcome", async () => {
    const pressed = activateSaisonAction({ id: SAISON_ID });

    assert.ok((await untilCall(1)).url.endsWith(`/saisons/${SAISON_ID}/activate`));
    advance(CALL_MS);
    assert.ok((await untilCall(2)).url.endsWith("/identitaet/loeschung/lauf"));
    advance(CALL_MS);

    const cut = await untilCall(3);
    assert.ok(cut.url.endsWith(`/identitaet/loeschung/lauf?nach=${ERSTER_LAUF.nach}`));
    advance(REQUEST_DEADLINE_MS - 2 * CALL_MS - 1);
    assert.equal(cut.signal.aborted, false, "the deletion call was aborted before the deadline");
    advance(1);
    assert.equal(cut.signal.aborted, true, "the deadline passed and the deletion call ran on to its own bound");

    const answer = await pressed;

    assert.equal(sent.length, 3, "a call went out after the deadline had passed");
    assert.equal(answer.success, true, `the cut press answered ${JSON.stringify(answer)}`);
    assert.equal(
      answer.success ? answer.message : undefined,
      "Saison 2026 ist jetzt aktiv. Die vorherige Saison ist abgeschlossen. 2 Spielerinnen und Spieler ohne Kadereintrag seit Saison " +
        "2025 wurden gelöscht. Die Löschung ist nicht vollständig durchgelaufen. Was noch aussteht, löscht der nächste stündliche Durchlauf.",
    );
  });

  /* The press's own deadline ending the run is expected wherever more pupils are due than it reaches: filed as an
     error, it sends the operator to repair a record nothing is wrong with. */
  it("files the cut as a warning, never under an error", async () => {
    loggedLines.length = 0;
    const pressed = activateSaisonAction({ id: SAISON_ID });

    await untilCall(1);
    advance(CALL_MS);
    await untilCall(2);
    advance(CALL_MS);
    await untilCall(3);
    advance(REQUEST_DEADLINE_MS - 2 * CALL_MS);
    await pressed;

    assert.deepEqual(
      loggedLines.filter(({ level, message }) => level !== "info" && message.startsWith("loeschung.")),
      [{ level: "warn", message: "loeschung.umstellung_cut_short", meta: { error_code: "FE-SWEEP-001", name: "APINetworkError" } }],
    );
  });
});
