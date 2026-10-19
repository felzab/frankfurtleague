import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  asDataUrl,
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  madeByPasskey,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/core/authDoubles.ts";
import { answerAt, NO_RECORDS, SITZ } from "@/core/subjectFixtures.ts";
import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

import type { SessionRow } from "@/core/authDoubles.ts";
import type { LookupFixture } from "@/core/subjectFixtures.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

const ADAPTER_DOUBLE = {
  mongodbAdapter: () => insertOrderedAdapter(store as unknown as MemoryDB),
};

const mail = registerAuthDoubles({
  // The admin key the person lane's erasure is sent under, beside the system key the gate reads with.
  core: {
    logging: LOGGING_DOUBLE,
    config: configDouble(GATE_BACKEND_CONFIG, { internalApiKeyAdmin: () => "fabricated-admin-not-a-credential" }),
  },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/cache": asDataUrl(NEXT_CACHE_DOUBLE),
    "@better-auth/mongo-adapter": ADAPTER_DOUBLE,
  },
});

const store = memoryStore("__flLoeschungStore");

/** What the backend holds for each address the subject read and the gate ask about, a live seat for any other. */
const HELD = new Map<string, LookupFixture>();

/** The counts the erasure answers a person holding one squad row. */
const ERASED = {
  acknowledged: 1,
  spieler: 1,
  saison_spieler: 1,
  schiedsrichter: 0,
  spiele: 0,
  kontakt_sitze: 0,
  registrierungen: 0,
  adresswechsel: 0,
  berechtigungen: 0,
  drosselung: 0,
};

/** What the backend's erasure answers, and every erasure it was asked for, with the actor header each carried. */
let erasureAnswer: () => Response = () => Response.json(ERASED);
const erasures: { method: string; actor: string | null }[] = [];

const ERASURE_PATH = "/api/v0/identitaet/selbst/erasure";

const ANSICHT_PATH = "/api/v0/identitaet/selbst/erasure/ansicht";

/** Whether the preview reads the press as the last owner's, and how often it was read since the case began. */
let letzterInhaber = false;
let ansichtReads = 0;

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path === ANSICHT_PATH) {
    ansichtReads += 1;
    const leer = { spieler: [], schiedsrichter: [], sitze: [], bewerbungen: [], registrierungen: [], adresswechsel: 0 };
    return Promise.resolve(Response.json({ acknowledged: 1, ...leer, verwaltung: "owner", letzter_inhaber: letzterInhaber }));
  }
  if (path === ERASURE_PATH) {
    erasures.push({ method: init?.method ?? "GET", actor: new Headers(init?.headers).get("x-fl-actor") });
    return Promise.resolve(erasureAnswer());
  }

  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  const fixture = HELD.get(email ?? "") ?? { ...NO_RECORDS, sitze: [SITZ], konto: true };
  return Promise.resolve(Response.json(answerAt(path, { acknowledged: 1, ...fixture })));
}) as typeof globalThis.fetch;

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { fordereKontoLoeschungAnAction } = await import("./actions.ts");
const { loescheKontoAction } = await import("./personActions.ts");
const { ANMELDUNG_ABGELAUFEN } = await import("@/shared/utils/actionError.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { readGrantHolderStepUp } = await import("./loeschungStepUp.ts");
const { LETZTE_INHABERIN, mapLoeschungRefusal } = await import("./refusals.ts");
const { toActionErrorResult } = await import("@/shared/utils/actionError.ts");
const { assertEachAnswered } = await import("@/shared/testing/publishedRefusals.ts");
const { auth } = await import("@/core/auth.ts");

const HOUR_MS = 60 * 60 * 1000;

/** What every failure past the spend adds but the link's own refusal, as the action spells it. */
const LINK_VERBRAUCHT = "Dieser Link ist dabei verbraucht worden. Für einen neuen Versuch fordere auf Deiner Kontoseite einen neuen an.";

beforeEach(() => {
  store.passkey.length = 0;
  store.verification.length = 0;
  cacheCalls.length = 0;
  erasures.length = 0;
  HELD.clear();
  erasureAnswer = () => Response.json(ERASED);
  letzterInhaber = false;
  ansichtReads = 0;
});

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  requestHeaders = new Headers({ ...ORIGIN, cookie });
}

/** A signed-in person holding a passkey, the request arriving as them, and a deletion link mailed to them. */
async function mitLink(email: string): Promise<{ row: SessionRow; token: string }> {
  const { cookie, row } = await sessionByCode(auth, store, email);
  store.passkey.push({ id: `passkey-${row.userId}`, userId: row.userId, credentialID: `credential-${row.userId}`, publicKey: "k", counter: 0 });
  arriveAs(cookie);

  const angefordert = await fordereKontoLoeschungAnAction();
  assert.equal(angefordert.success, true, `the account page's press answered ${JSON.stringify(angefordert)}`);
  const found = /\/loeschung\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the mail carries no link to the interstitial");

  return { row, token: found[1] };
}

/** What the store still holds of the account `userId` names. */
const heldOf = (userId: string) => ({
  user: store.user.filter((user) => user.id === userId).length,
  passkeys: store.passkey.filter((passkey) => passkey.userId === userId).length,
});

describe("a person's own account deletion, from the account page's press to the interstitial's", () => {
  it("erases the records under the person's actor, then deletes the account, and drops both base tags", async () => {
    const { row, token } = await mitLink("ganz-weg@example.org");

    const answer = await loescheKontoAction(token);

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(
      erasures.map(({ method, actor }) => [method, actor !== null]),
      [["POST", true]],
      "the erasure was not sent once, as a write naming its person",
    );
    assert.deepEqual(heldOf(row.userId), { user: 0, passkeys: 0 });
    assert.deepEqual(
      cacheCalls.filter(({ name }) => name === "updateTag").flatMap(({ args }) => args),
      ["spieler", "spiele"],
    );
  });

  /* Asked and refused: a case passing where the hook never ran would leave the same rows standing. */
  it("leaves the account and its passkeys where the backend refuses the erasure, having asked it, in the refusal's own words", async () => {
    const { row, token } = await mitLink("verweigert@example.org");
    // A ban entered since the spine judged the session, which the person route asks again.
    erasureAnswer = () => Response.json({ error_code: "REQ-AUTH-008", trace_id: "0".repeat(32) }, { status: 403 });

    const answer = await loescheKontoAction(token);

    assert.equal(erasures.length, 1, "the backend was never asked, so the refusal proves nothing");
    assert.match(answer.success ? "" : answer.error, /Diese E-Mail-Adresse ist gesperrt/);
    assert.ok(
      !answer.success && answer.error.endsWith(` ${LINK_VERBRAUCHT}`),
      "the refusal asks for no new link, though the press spent this one",
    );
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
  });

  /* `fl_frontend/src/app/refusalCoverage.test.ts` hands this proof to the slice: each published refusal, at its
     own status and another, reaches the action's own mapper, and every press spends a link, so each act mints
     its own. */
  it("answers each published refusal of the erasure through its own mapper, adding the new link the spent one needs", async () => {
    let erasureRefused: Promise<void> = Promise.resolve();
    let acts = 0;

    await assertEachAnswered({
      operation: "POST /identitaet/selbst/erasure",
      // The write double's refusal, as the fetch double answers it: the API client raises it again from the body.
      refuseWith: (next) => {
        erasureRefused = next().then(
          () => assert.fail("the refusal the assertion handed in answered"),
          (refusal: { serverErrorCode?: string; statusCode: number }) => {
            erasureAnswer = () =>
              Response.json({ error_code: refusal.serverErrorCode, trace_id: "0".repeat(32) }, { status: refusal.statusCode });
          },
        );
      },
      act: async () => {
        await erasureRefused;
        acts += 1;
        const { token } = await mitLink(`verweigert-${String(acts)}@example.org`);
        return loescheKontoAction(token);
      },
      mapped: (refusal) => `${mapLoeschungRefusal(refusal)?.error ?? toActionErrorResult(refusal).error} ${LINK_VERBRAUCHT}`,
    });

    assert.ok(acts > 0, "the document publishes no refusal on the erasure, so nothing was asked");
  });

  /* An answer lost past the spend reads as a write of unknown outcome, whose own words invite a retry the
     spent link cannot take. */
  it("answers an erasure whose answer was lost with the new link the spent one needs", async () => {
    const { row, token } = await mitLink("verloren@example.org");
    erasureAnswer = () => Response.json({ error_code: "DB-CONN-001", trace_id: "0".repeat(32) }, { status: 503 });

    const answer = await loescheKontoAction(token);

    assert.equal(erasures.length, 1, "the backend was never asked, so the answer proves nothing");
    assert.ok(!answer.success && answer.error.endsWith(` ${LINK_VERBRAUCHT}`), JSON.stringify(answer));
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
  });

  /* The library reads a barred person's leftover session, or one its account's sessions were ended before, as
     a session like any other: the person spine's own judgement is what refuses both. */
  for (const [label, email, judged] of [
    [
      "barred since the link was mailed",
      "gesperrt-seither@example.org",
      () => void HELD.set("gesperrt-seither@example.org", { ...NO_RECORDS, gesperrt: true, konto: true }),
    ],
    [
      "ended by its account after it was made",
      "beendet-seither@example.org",
      () => {
        const account = store.user.find((user) => user.email === "beendet-seither@example.org");
        assert.ok(account !== undefined, "the sign-in wrote no account");
        account.sessionsEndedAt = new Date();
      },
    ],
  ] as const) {
    it(`deletes and erases nothing from a session ${label}`, async () => {
      const { row, token } = await mitLink(email);
      judged();

      assert.deepEqual(await loescheKontoAction(token), { success: false, error: ANMELDUNG_ABGELAUFEN });
      assert.deepEqual(erasures, []);
      assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
    });
  }

  /** A signed-in owner holding a passkey, the request arriving as their passkey session, and a link mailed to them. */
  async function verwaltendMitLink(email: string, stufe: "owner" | "administration" = "owner"): Promise<{ row: SessionRow; token: string }> {
    HELD.set(email, {
      ...NO_RECORDS,
      verwaltung: stufe,
      berechtigt_seit: "2026-01-01T00:00:00Z",
      inhaber_seit: stufe === "owner" ? "2026-01-01T00:00:00Z" : null,
      konto: false,
    });
    const durchPasskey = await sessionByCode(auth, store, email);
    madeByPasskey(store, durchPasskey.row);
    arriveAs(durchPasskey.cookie);
    assert.equal((await fordereKontoLoeschungAnAction()).success, true, "the grant holder's passkey session mailed no link");
    const found = /\/loeschung\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
    assert.ok(found?.[1] !== undefined, "the mail carries no link to the interstitial");

    return { row: durchPasskey.row, token: found[1] };
  }

  /* A grant goes with the account, so a grant holder is held to a revoke's own window, a passkey confirmation
     of the last five minutes, judged before the library spends the link (`docs/frontend/spec.md :: I707`). */
  for (const [label, email, pressedFrom, proceeds] of [
    ["the mailbox alone", "verwaltung-code@example.org", "code", false],
    ["a passkey ten minutes ago", "verwaltung-spaet@example.org", 10, false],
    ["a passkey a minute ago", "verwaltung-frisch@example.org", 1, true],
  ] as const) {
    it(`${proceeds ? "deletes" : "asks for the passkey and deletes nothing, the link left standing,"} for a grant holder signed in by ${label}`, async () => {
      const { row, token } = await verwaltendMitLink(email);

      if (pressedFrom === "code") arriveAs((await sessionByCode(auth, store, email)).cookie);
      else row.createdAt = new Date(Date.now() - pressedFrom * 60 * 1000);
      cacheCalls.length = 0;
      const answer = await loescheKontoAction(token);

      if (proceeds) {
        assert.equal(answer.success, true, JSON.stringify(answer));
        assert.equal(erasures.length, 1);
        assert.deepEqual(heldOf(row.userId), { user: 0, passkeys: 0 });
        return;
      }
      assert.deepEqual(answer, stepUpRequired(), "the press was not answered with the page's passkey prompt");
      assert.ok(
        cacheCalls.some(({ name }) => name === "refresh"),
        "the page's figures were not read again, so its next press would send unasked (`docs/frontend/spec.md :: I433`)",
      );
      assert.deepEqual(erasures, []);
      assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
      assert.ok(
        store.verification.some((held) => held.identifier === `delete-account-${token}`),
        "the refused press spent the link, which the grant holder can no longer open",
      );
    });
  }

  /* The page's prompt mints a passkey session, the same as a sign-in: the link the refused press left standing
     then completes, which is what refusing it before the library spends it is for. */
  it("deletes on the same link once the grant holder confirmed by passkey after the press was refused", async () => {
    const email = "verwaltung-bestaetigt@example.org";
    const { row, token } = await verwaltendMitLink(email);
    row.createdAt = new Date(Date.now() - 10 * 60 * 1000);
    assert.deepEqual(await loescheKontoAction(token), stepUpRequired());

    const bestaetigt = await sessionByCode(auth, store, email);
    madeByPasskey(store, bestaetigt.row);
    arriveAs(bestaetigt.cookie);
    const answer = await loescheKontoAction(token);

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.equal(erasures.length, 1);
    assert.deepEqual(heldOf(row.userId), { user: 0, passkeys: 0 });
  });

  /* The backend refuses the league's last owner, whose erasure would leave the administration owned by nobody. */
  /* Refused before the library spends the link (`docs/frontend/spec.md :: I708`): the same link completes once
     another owner is made, which a refusal after the spend could not offer. */
  it("refuses the league's last owner before the link is spent, and deletes on the same link once another owns", async () => {
    const { row, token } = await verwaltendMitLink("letzte-inhaberin@example.org");
    letzterInhaber = true;

    assert.deepEqual(await loescheKontoAction(token), { success: false, error: LETZTE_INHABERIN });
    assert.deepEqual(erasures, [], "the erasure was asked for although the preview read the last owner");
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
    assert.ok(
      store.verification.some((held) => held.identifier === `delete-account-${token}`),
      "the refused press spent the link, which the owner can no longer open",
    );

    letzterInhaber = false;
    const answer = await loescheKontoAction(token);

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(heldOf(row.userId), { user: 0, passkeys: 0 });
  });

  /* Two owners pressing at once both read another owner, and the backend refuses the second after its link
     was spent: its words add that a new link is needed. */
  it("words the backend's own last-owner refusal with the new link it needs, having asked the backend", async () => {
    const { row, token } = await verwaltendMitLink("zweite-inhaberin@example.org");
    erasureAnswer = () => Response.json({ error_code: "REQ-PURGE-004", trace_id: "0".repeat(32) }, { status: 409 });

    const answer = await loescheKontoAction(token);

    assert.equal(erasures.length, 1, "the backend was never asked, so the refusal proves nothing");
    assert.equal(answer.success ? "" : answer.error, `${LETZTE_INHABERIN} ${LINK_VERBRAUCHT}`);
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
    assert.ok(
      !store.verification.some((held) => held.identifier === `delete-account-${token}`),
      "the link still stands, so the sentence asking for a new one is wrong",
    );
  });

  /* The backend's own window refused a press the page's check admitted at the window's edge, after the library
     spent the link: the page asks for the passkey, and its next press meets the spent link's own words. */
  it("answers the backend's confirmation refusal as the page's passkey prompt, the page's figures read again", async () => {
    const { row, token } = await verwaltendMitLink("verwaltung-backend-fenster@example.org");
    erasureAnswer = () => Response.json({ error_code: "REQ-AUTH-009", trace_id: "0".repeat(32) }, { status: 401 });
    cacheCalls.length = 0;

    const answer = await loescheKontoAction(token);

    assert.equal(erasures.length, 1, "the backend was never asked, so the refusal proves nothing");
    assert.deepEqual(answer, { ...stepUpRequired(), error: `${stepUpRequired().error} ${LINK_VERBRAUCHT}` });
    assert.ok(
      cacheCalls.some(({ name }) => name === "refresh"),
      "the page's figures were not read again, so its next press would send unasked (`docs/frontend/spec.md :: I493`)",
    );
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
  });

  it("reads no preview for a grant holder who owns nothing, who can be nobody's last owner", async () => {
    const { row, token } = await verwaltendMitLink("verwaltung-ohne-inhaberschaft@example.org", "administration");
    letzterInhaber = true;

    const answer = await loescheKontoAction(token);

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.equal(ansichtReads, 0);
    assert.deepEqual(heldOf(row.userId), { user: 0, passkeys: 0 });
  });

  it("refuses a link the library refuses, in words naming the fresh one, erasing nothing", async () => {
    const { row } = await mitLink("falscher-link@example.org");

    const answer = await loescheKontoAction("kein-gemailter-link");

    assert.match(answer.success ? "" : answer.error, /Fordere auf Deiner Kontoseite einen neuen an\./);
    assert.ok(!answer.success && !answer.error.includes(LINK_VERBRAUCHT), "the link's own refusal says twice that a new one is needed");
    assert.deepEqual(erasures, []);
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
  });

  /* Every press mints a token row and mails a link, so the press counts on the address's own mail bound: past
     its fifth, it answers as sent and mints and mails nothing (`docs/frontend/spec.md :: I713`). */
  it("answers every press past the address's fifth link as sent, minting no token row and mailing nothing", async () => {
    const email = "loeschlink-schleife@example.org";
    const { cookie, row } = await sessionByCode(auth, store, email);
    arriveAs(cookie);

    const answers = [];
    for (let press = 0; press < 50; press += 1) answers.push(await fordereKontoLoeschungAnAction());

    assert.ok(
      answers.every((answer) => answer.success),
      "a press past the bound answered apart from a sent one",
    );
    assert.equal(new Set(answers.map((answer) => JSON.stringify(answer))).size, 1, "a capped press answers apart from a mailed one");
    assert.equal(mail.sent.filter((sent) => sent.to === email).length, 5, "the address was mailed past its hour's five");
    assert.equal(
      store.verification.filter((held) => held.identifier.startsWith("delete-account-") && held.value === row.userId).length,
      5,
      "a capped press minted a token row",
    );
  });

  /* The link goes to the session's own mailbox, so a session past the step-up window still asks for one
     (`docs/frontend/spec.md :: I676`). */
  it("mails the link from a session signed in past the step-up window", async () => {
    const { cookie, row } = await sessionByCode(auth, store, "spaeter@example.org");
    row.createdAt = new Date(Date.now() - 3 * HOUR_MS);
    arriveAs(cookie);

    assert.equal((await fordereKontoLoeschungAnAction()).success, true);
    assert.ok(
      mail.sent.some((sent) => sent.to === "spaeter@example.org"),
      "no link was mailed",
    );
  });

  /* What the interstitial's prompt is served, read off the same session the press judges: a window the page
     showed open and the press refused would send a press nobody was asked for. */
  it("serves a grant holder's page the enrolment's window exactly where the press would pass it", async () => {
    const email = "verwaltung-seite@example.org";
    const { row } = await verwaltendMitLink(email);

    const frisch = await readGrantHolderStepUp();
    assert.equal(frisch?.stepUp.holderId, row.userId);
    assert.equal(frisch.hasPasskey, true);
    assert.ok(frisch.stepUp.enrolmentUntil !== null, "a passkey session of this moment read as past the window");

    arriveAs((await sessionByCode(auth, store, email)).cookie);
    const perPost = await readGrantHolderStepUp();
    assert.equal(perPost?.stepUp.holderId, row.userId, "the prompt would check its assertion against another account");
    assert.equal(perPost.stepUp.enrolmentUntil, null, "a session the mailbox made read as inside the passkey window");
  });
});
