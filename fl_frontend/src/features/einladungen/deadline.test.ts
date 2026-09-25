import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

/* The real client, mail transport and fan-out, only their network doubled below: what is driven is
   the chain those three and the admin spine make of one season-wide press, which a double of any of
   them would hide. */
const API_URL = "http://backend:8000";

const CONFIG = `export const frontend_config = {
  API_URL: "${API_URL}",
  API_VERSION: 0,
  INTERNAL_API_KEY_BASE: "base-key-double",
  INTERNAL_API_KEY_SYSTEM: "system-key-double",
  INTERNAL_API_KEY_ADMIN: "admin-key-double",
  APP_ENV: "production",
  AUTH_RESEND_KEY: "resend-key-double",
  AUTH_URL: "https://liga.example.de",
};`;

doubleActionRequest();

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { postEinladungVersandAction } = await import("./actions.ts");
const { REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

const SAISON_ID = "2627";

/** How long the provider takes over each message: inside the transport's own bound, and three of them outside the deadline. */
const SEND_MS = 14000;

const TEAMS = ["1", "2", "3", "4"].map((digit) => ({ id: digit.repeat(24), email: `trainer${digit}@beispiel.de` }));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const VERSAND = {
  acknowledged: 1,
  saison_id: SAISON_ID,
  zeilen: TEAMS.map(({ id, email }) => ({
    team_id: id,
    team_name: `Schule ${id.slice(0, 1)}`,
    empfaenger: [{ rolle: "trainer", vorname: "Jonas", email: email }],
    uebersprungen: null,
    ersetzt_link: false,
    einladung_id: id.replaceAll(id.slice(0, 1), "e"),
    token: `linkwert-${id.slice(0, 1)}`,
    hatte_link: false,
  })),
};

/** Every message the provider was handed, with the signal that could abort it. */
const mails: { signal: AbortSignal }[] = [];

// Honours the signal as the real `fetch` does, so a message the deadline aborts ends as a real one would.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/einladungen/versand")) return json(VERSAND);
  if (url.endsWith("/zustellung/angenommen")) return json({ acknowledged: 1, angewendet: true });
  // Every other call is the provider's, whose address `mail.ts` alone names.
  assert.ok(!url.startsWith(API_URL), `the press reached a backend route nothing here answers: ${url}`);

  const signal = init?.signal ?? assert.fail("a message went out unbounded");
  mails.push({ signal: signal });
  if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });

  return await new Promise<Response>((resolve, reject) => {
    setTimeout(() => resolve(json({ id: `nachricht-${String(mails.length)}` })), SEND_MS);
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
}) as typeof fetch;

/** `performance.now()`'s reading, which the mocked timers leave alone and `advance` moves beside them. */
let clock = 0;
const advance = (ms: number) => {
  clock += ms;
  mock.timers.tick(ms);
};

/** Bounded, so a press that stops short of the message fails naming it rather than spinning. */
async function untilMessage(count: number): Promise<AbortSignal> {
  for (let turn = 0; turn < 1000 && mails.length < count; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return mails[count - 1]?.signal ?? assert.fail(`message ${String(count)} was never handed to the provider`);
}

beforeEach(() => {
  mails.length = 0;
  clock = 0;
  mock.method(performance, "now", () => clock);
  mock.timers.enable({ apis: ["setTimeout"] });
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

describe("a season-wide invite press the request's deadline cuts", () => {
  /* Team after team at a slow provider would otherwise run past nginx's cut, which answers the
     administrator 504 while the press goes on mailing. */
  it("stops mailing at the deadline, and answers the press as of unknown outcome", async () => {
    const pressed = postEinladungVersandAction({ id: SAISON_ID, erneut: false });

    for (const count of [1, 2]) {
      await untilMessage(count);
      advance(SEND_MS);
    }

    const third = await untilMessage(3);
    advance(REQUEST_DEADLINE_MS - 2 * SEND_MS - 1);
    assert.equal(third.aborted, false, "the third message was aborted before the deadline");
    advance(1);
    assert.equal(third.aborted, true, "the deadline passed and the third message ran on to its own bound");

    const answer = await pressed;

    assert.equal(mails.length, 3, "a message was handed to the provider after the deadline had passed");
    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `the cut press answered ${JSON.stringify(answer)}`);
  });
});
