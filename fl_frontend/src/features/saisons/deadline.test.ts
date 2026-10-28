import { doubleActionRequest, loggedLines } from "@/test-support/actionDoubles.ts";
import { saisonRules } from "@/test-support/saisonRules.ts";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

/* The real action, client and request scope, only their network doubled below: what is driven is the deadline
   ending the deletion inside the activation press, which a doubled client would have to restage. */
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

vi.doMock("@/core/config.ts", () => CONFIG);

const { activateSaisonAction } = await import("./actions.ts");
const { REQUEST_DEADLINE_MS } = await import("@/core/requestScope");
const { WRITE_NEEDS_MS } = await import("@/core/api");

const SAISON_ID = "2026";

/** How long the first deletion call takes: inside a call's own bound, as a whole share's erasures are. */
const CALL_MS = 10000;

/** How long the activation takes, which a case sets: it decides how much of the deadline the deletion starts with. */
let aktivierungMs = CALL_MS;

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

/* `docs/frontend/spec.md :: I733`: a call sent with less left could go on deleting after the spine dropped `spieler`, and
   the squad page would serve the pupils it deleted. */
describe("an activation whose deletion would outrun the request's deadline", () => {
  /**
   * The press through the activation and the first deletion call, then settled. A third call, which it must not send,
   * is run on to the deadline rather than left holding the case open, so the count below fails instead.
   */
  async function pressedToItsStop() {
    const pressed = activateSaisonAction({ id: SAISON_ID });
    let settled = false;
    void pressed.then(() => (settled = true));

    await untilCall(1);
    advance(aktivierungMs);
    await untilCall(2);
    advance(CALL_MS);
    for (let turn = 0; turn < 1000 && !settled && sent.length < 3; turn++) await new Promise((resolve) => setImmediate(resolve));
    if (sent.length > 2) advance(REQUEST_DEADLINE_MS);

    return pressed;
  }

  /* The activation was acknowledged before the deletion began, so only the deletion is unfinished, and the hourly pass
     finishes it: answered as of unknown outcome, the press sends the administrator to check a season change that stands. */
  it("sends no deletion call it cannot wait out, answering the activation saved and the deletion unfinished", async () => {
    assert.ok(REQUEST_DEADLINE_MS - aktivierungMs - CALL_MS < WRITE_NEEDS_MS, "the case leaves the second call its need, so proves nothing");

    const answer = await pressedToItsStop();

    expect(
      sent.map(({ url }) => new URL(url).pathname),
      "a deletion call went out with too little left to wait out its answer",
    ).toStrictEqual([`/api/v0/saisons/${SAISON_ID}/activate`, "/api/v0/identitaet/loeschung/lauf"]);
    expect(answer.success, `the stopped press answered ${JSON.stringify(answer)}`).toBe(true);
    expect(answer.success ? answer.message : undefined).toBe(UNVOLLSTAENDIG);
  });

  /* Wherever more pupils are due than the deadline reaches, this is the run's expected end: filed as an error, it sends
     the operator to repair a record nothing is wrong with. */
  it("files the stop as a warning, never under an error", async () => {
    await pressedToItsStop();

    expect(deletionLines()).toStrictEqual([
      {
        level: "warn",
        message: "loeschung.umstellung_cut_short",
        meta: { error_code: "FE-SWEEP-001", name: "ApiUnsentError", trace_id: false },
      },
    ]);
  });
});

describe("an activation whose deletion call the request's deadline cuts", () => {
  /* Sent with its need left, a call still meets the deadline where the backend overran its own: the press answers that
     cut itself, and the hourly pass's drop of `spieler` follows whatever the call deleted (`docs/frontend/spec.md :: I705`). */
  it("answers the activation saved and the deletion unfinished, never as of unknown outcome, and files a warning", async () => {
    aktivierungMs = REQUEST_DEADLINE_MS - CALL_MS - WRITE_NEEDS_MS;
    const pressed = activateSaisonAction({ id: SAISON_ID });

    await untilCall(1);
    advance(aktivierungMs);
    await untilCall(2);
    advance(CALL_MS);

    const cut = await untilCall(3);
    assert.ok(cut.url.endsWith(`/identitaet/loeschung/lauf?nach=${ERSTER_LAUF.nach}`));
    advance(WRITE_NEEDS_MS - 1);
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
        meta: { error_code: "FE-SWEEP-001", name: "APINetworkError", trace_id: true },
      },
    ]);
  });
});
