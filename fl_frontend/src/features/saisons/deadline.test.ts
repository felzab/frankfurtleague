import { doubleActionRequest, loggedLines } from "@/test-support/actionDoubles.ts";
import { saisonRules } from "@/test-support/saisonRules.ts";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

/* The real action, client and request scope, only their network doubled below: what is driven is the deadline
   ending the deletion inside the activation press, which a doubled client would have to restage. */
const API_URL = "http://backend:8000";

const CONFIG = {
  frontend_config: {
    API_URL: API_URL,
    APP_ENV: "production",
    AUTH_URL: "https://liga.example.de",
    LOESCHUNG_SWEEP: "on",
  },
  internalApiKeyBase: () => "base-key-double",
  internalApiKeySystem: () => "system-key-double",
  internalApiKeyAdmin: () => "admin-key-double",
};

doubleActionRequest();

vi.doMock("@/core/config.ts", () => CONFIG);

const { activateSaisonAction } = await import("./actions.ts");
const { REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

const SAISON_ID = "2026";

/** How long the first deletion call takes: inside a call's own bound, as a whole share's erasures are. */
const CALL_MS = 10000;

/** How long the activation takes, which a case sets: it decides how much of the deadline the deletion starts with. */
let aktivierungMs = CALL_MS;

/** What the deadline leaves the second deletion call: inside its own fetch bound, so the deadline is what cuts it. */
const LEFT_FOR_THE_CUT_MS = 12000;

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

/** What the press answers wherever the deadline ends its deletion after the first call. */
const UNVOLLSTAENDIG =
  "Saison 2026 ist jetzt aktiv. Die vorherige Saison ist abgeschlossen. 2 Spielerinnen und Spieler ohne Kadereintrag seit Saison " +
  "2025 wurden gelöscht. Die Löschung ist nicht vollständig durchgelaufen. Was noch aussteht, löscht der nächste stündliche Durchlauf.";

/** Every call the press sent, with the signal that could abort it. */
const sent: { url: string; signal: AbortSignal }[] = [];

// Honours the signal as the real `fetch` does. The second deletion call never answers: only an abort ends it.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const signal = init?.signal ?? assert.fail("a call went out unbounded");
  sent.push({ url: url, signal: signal });
  if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });

  const aktivierung = url.endsWith("/activate");
  const antwort = aktivierung ? AKTIVIERT : sent.length === 2 ? ERSTER_LAUF : null;

  return await new Promise<Response>((resolve, reject) => {
    if (antwort !== null) setTimeout(() => resolve(json(antwort)), aktivierung ? aktivierungMs : CALL_MS);
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
}) as typeof fetch;

/** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

/** Bounded, so a press that stops short of the call fails naming it rather than spinning. */
async function untilCall(count: number): Promise<{ url: string; signal: AbortSignal }> {
  for (let turn = 0; turn < 1000 && sent.length < count; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return sent[count - 1] ?? assert.fail(`call ${String(count)} was never sent`);
}

/** The press's lines about its deletion above info, the trace judged by its shape: the client mints it per call. */
const deletionLines = () =>
  loggedLines
    .filter(({ level, message }) => level !== "info" && message.startsWith("loeschung."))
    .map((line) => ({
      ...line,
      meta: { ...(line.meta as object), trace_id: /^[0-9a-f]{32}$/.test(String((line.meta as { trace_id?: unknown }).trace_id)) },
    }));

beforeEach(() => {
  sent.length = 0;
  loggedLines.length = 0;
  clock = 0;
  aktivierungMs = CALL_MS;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("an activation whose deletion call the request's deadline cuts", () => {
  /* The press answers that cut itself, and the hourly pass's drop of `spieler` follows whatever the call deleted. */
  it("answers the activation saved and the deletion unfinished, never as of unknown outcome, and files a warning", async () => {
    aktivierungMs = REQUEST_DEADLINE_MS - CALL_MS - LEFT_FOR_THE_CUT_MS;
    const pressed = activateSaisonAction({ id: SAISON_ID });

    await untilCall(1);
    advance(aktivierungMs);
    await untilCall(2);
    advance(CALL_MS);

    const cut = await untilCall(3);
    assert.ok(cut.url.endsWith(`/identitaet/loeschung/lauf?nach=${ERSTER_LAUF.nach}`));
    advance(LEFT_FOR_THE_CUT_MS - 1);
    expect(cut.signal.aborted, "the deletion call was aborted before the deadline").toBe(false);
    advance(1);
    expect(cut.signal.aborted, "the deadline passed and the deletion call ran on to its own bound").toBe(true);

    const answer = await pressed;

    expect(sent.length, "a call went out after the deadline had passed").toBe(3);
    expect(answer.success, `the cut press answered ${JSON.stringify(answer)}`).toBe(true);
    expect(answer.success ? answer.message : undefined).toBe(UNVOLLSTAENDIG);
    expect(deletionLines()).toStrictEqual([
      {
        level: "warn",
        message: "loeschung.umstellung_cut_short",
        meta: { name: "APINetworkError", trace_id: true },
      },
    ]);
  });
});
