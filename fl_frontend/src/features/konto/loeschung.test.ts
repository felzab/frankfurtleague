import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/test-support/actionDoubles.ts";
import {
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  madeByPasskey,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/test-support/authDoubles.ts";
import { answerAt, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import { SITE_CACHE_TAG } from "@/core/siteCache.ts";

import type { SessionRow } from "@/test-support/authDoubles.ts";
import type { LookupFixture } from "@/test-support/subjectFixtures.ts";
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
    "next/cache": NEXT_CACHE_DOUBLE,
    "@better-auth/mongo-adapter": ADAPTER_DOUBLE,
  },
});

const store = memoryStore("__flLoeschungStore");

/** What the backend holds for each address the subject read and the gate ask about, a live seat for any other. */
const HELD = new Map<string, LookupFixture>();

/** The counts the erasure answers a person holding one squad row. */
const GELOESCHT = {
  spieler: 1,
  saison_spieler: 1,
  schiedsrichter: 0,
  spiele: 0,
  kontakt_seats: 0,
  registrierungen: 0,
  address_change: 0,
  grants: 0,
  grants_approval_requests: 0,
};

/** What the backend's erasure answers, and every erasure it was asked for, with the actor header each carried. */
let loeschungAnswer: () => Response = () => Response.json(GELOESCHT);
const loeschungen: { method: string; actor: string | null }[] = [];

const LOESCHUNG_PATH = "/api/v0/identity/account/erasure";

const ANSICHT_PATH = "/api/v0/identity/account/erasure/view";

/** Whether the preview reads the press as the last owner's, and how often it was read since the case began. */
let letzterInhaber = false;
let ansichtReads = 0;

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path === ANSICHT_PATH) {
    ansichtReads += 1;
    const leer = { spieler: [], schiedsrichter: [], seats: [], bewerbungen: [], registrierungen: [], address_change: 0 };
    return Promise.resolve(Response.json({ ...leer, verwaltung: "owner", last_owner: letzterInhaber }));
  }
  if (path === LOESCHUNG_PATH) {
    loeschungen.push({ method: init?.method ?? "GET", actor: new Headers(init?.headers).get("x-fl-actor") });
    return Promise.resolve(loeschungAnswer());
  }

  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  const fixture = HELD.get(email ?? "") ?? { ...NO_RECORDS, seats: [SEAT], account: true };
  return Promise.resolve(Response.json(answerAt(path, fixture)));
}) as typeof globalThis.fetch;

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { fordereKontoLoeschungAnAction } = await import("./actions.ts");
const { loescheKontoAction } = await import("./personActions.ts");
const { ANMELDUNG_ABGELAUFEN } = await import("@/shared/utils/actionError.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { readGrantHolderStepUp } = await import("./loeschungStepUp.ts");
const { LETZTE_INHABERIN, mapLoeschungRefusal } = await import("./refusals.ts");
const { toActionErrorResult } = await import("@/shared/utils/actionError.ts");
const { assertEachAnswered, refusalCodes } = await import("@/test-support/refusals.ts");
const { auth } = await import("@/core/auth.ts");

const HOUR_MS = 60 * 60 * 1000;

/** What every failure past the spend adds but the link's own refusal, as the action spells it. */
const LINK_VERBRAUCHT = "Dieser Link ist dabei verbraucht worden. Für einen neuen Versuch fordere auf Deiner Kontoseite einen neuen an.";

beforeEach(() => {
  store.passkey.length = 0;
  store.verification.length = 0;
  cacheCalls.length = 0;
  loeschungen.length = 0;
  HELD.clear();
  loeschungAnswer = () => Response.json(GELOESCHT);
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
  expect(angefordert.success, `the account page's press answered ${JSON.stringify(angefordert)}`).toBe(true);
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
  it("erases the records under the person's actor, then deletes the account, and clears the site's cache tag", async () => {
    const { row, token } = await mitLink("ganz-weg@example.org");
    // The link's own press cleared it too, mailing being a write.
    cacheCalls.length = 0;

    const answer = await loescheKontoAction(token);

    expect(answer.success, JSON.stringify(answer)).toBe(true);
    expect(
      loeschungen.map(({ method, actor }) => [method, actor !== null]),
      "the erasure was not sent once, as a write naming its person",
    ).toStrictEqual([["POST", true]]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
    expect(cacheCalls.filter(({ name }) => name === "updateTag").flatMap(({ args }) => args)).toStrictEqual([SITE_CACHE_TAG]);
  });

  /* Asked and refused: a case passing where the hook never ran would leave the same rows standing. */
  it("leaves the account and its passkeys where the backend refuses the erasure, having asked it, in the refusal's own words", async () => {
    const { row, token } = await mitLink("verweigert@example.org");
    // A ban entered since the spine judged the session, which the person route asks again.
    loeschungAnswer = () => Response.json({ error_code: "person_barred", trace_id: "0".repeat(32) }, { status: 403 });

    const answer = await loescheKontoAction(token);

    expect(loeschungen.length, "the backend was never asked, so the refusal proves nothing").toBe(1);
    expect(answer.success ? "" : answer.error).toMatch(/Diese E-Mail-Adresse ist gesperrt/);
    assert.ok(
      !answer.success && answer.error.endsWith(` ${LINK_VERBRAUCHT}`),
      "the refusal asks for no new link, though the press spent this one",
    );
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
  });

  /* Each published refusal of the erasure, at its own status and another, reaches the action's own mapper, and every press spends a link, so each act mints
     its own. */
  it("answers each published refusal of the erasure through its own mapper, adding the new link the spent one needs", async () => {
    let loeschungRefused: Promise<void> = Promise.resolve();
    let acts = 0;

    await assertEachAnswered({
      codes: refusalCodes("duplicate_key", "last_owner_erasure"),
      // The write double's refusal, as the fetch double answers it: the API client raises it again from the body.
      refuseWith: (next) => {
        loeschungRefused = next().then(
          () => assert.fail("the refusal the assertion handed in answered"),
          (refusal: { serverErrorCode?: string; statusCode: number }) => {
            loeschungAnswer = () =>
              Response.json({ error_code: refusal.serverErrorCode, trace_id: "0".repeat(32) }, { status: refusal.statusCode });
          },
        );
      },
      act: async () => {
        await loeschungRefused;
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
    loeschungAnswer = () => Response.json({ error_code: "no_database_client", trace_id: "0".repeat(32) }, { status: 503 });

    const answer = await loescheKontoAction(token);

    expect(loeschungen.length, "the backend was never asked, so the answer proves nothing").toBe(1);
    assert.ok(!answer.success && answer.error.endsWith(` ${LINK_VERBRAUCHT}`), JSON.stringify(answer));
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
  });

  /* The library reads a barred person's leftover session, or one its account's sessions were ended before, as
     a session like any other: the person spine's own judgement is what refuses both. */
  for (const [label, email, judged] of [
    [
      "barred since the link was mailed",
      "gesperrt-seither@example.org",
      () => void HELD.set("gesperrt-seither@example.org", { ...NO_RECORDS, barred: true, account: true }),
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

      expect(await loescheKontoAction(token)).toStrictEqual({ success: false, error: ANMELDUNG_ABGELAUFEN });
      expect(loeschungen).toStrictEqual([]);
      expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
    });
  }

  /** A signed-in owner holding a passkey, the request arriving as their passkey session, and a link mailed to them. */
  async function verwaltendMitLink(email: string, stufe: "owner" | "administration" = "owner"): Promise<{ row: SessionRow; token: string }> {
    HELD.set(email, {
      ...NO_RECORDS,
      verwaltung: stufe,
      granted_since: "2026-01-01T00:00:00Z",
      inhaber_seit: stufe === "owner" ? "2026-01-01T00:00:00Z" : null,
      account: false,
    });
    const durchPasskey = await sessionByCode(auth, store, email);
    madeByPasskey(store, durchPasskey.row);
    arriveAs(durchPasskey.cookie);
    expect((await fordereKontoLoeschungAnAction()).success, "the grant holder's passkey session mailed no link").toBe(true);
    const found = /\/loeschung\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
    assert.ok(found?.[1] !== undefined, "the mail carries no link to the interstitial");

    return { row: durchPasskey.row, token: found[1] };
  }

  /* A grant goes with the account, so a grant holder is held to a revoke's own window, a passkey confirmation
     of the last five minutes, judged before the library spends the link. */
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
        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect(loeschungen.length).toBe(1);
        expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
        return;
      }
      expect(answer, "the press was not answered with the page's passkey prompt").toStrictEqual(stepUpRequired());
      assert.ok(
        cacheCalls.some(({ name }) => name === "refresh"),
        "the page's figures were not read again, so its next press would send unasked",
      );
      expect(loeschungen).toStrictEqual([]);
      expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
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
    expect(await loescheKontoAction(token)).toStrictEqual(stepUpRequired());

    const bestaetigt = await sessionByCode(auth, store, email);
    madeByPasskey(store, bestaetigt.row);
    arriveAs(bestaetigt.cookie);
    const answer = await loescheKontoAction(token);

    expect(answer.success, JSON.stringify(answer)).toBe(true);
    expect(loeschungen.length).toBe(1);
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
  });

  /* The backend refuses the league's last owner, whose erasure would leave the administration owned by nobody. */
  /* Refused before the library spends the link: the same link completes once
     another owner is made, which a refusal after the spend could not offer. */
  it("refuses the league's last owner before the link is spent, and deletes on the same link once another owns", async () => {
    const { row, token } = await verwaltendMitLink("letzte-inhaberin@example.org");
    letzterInhaber = true;

    expect(await loescheKontoAction(token)).toStrictEqual({ success: false, error: LETZTE_INHABERIN });
    expect(loeschungen, "the erasure was asked for although the preview read the last owner").toStrictEqual([]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
    assert.ok(
      store.verification.some((held) => held.identifier === `delete-account-${token}`),
      "the refused press spent the link, which the owner can no longer open",
    );

    letzterInhaber = false;
    const answer = await loescheKontoAction(token);

    expect(answer.success, JSON.stringify(answer)).toBe(true);
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
  });

  /* Two owners pressing at once both read another owner, and the backend refuses the second after its link
     was spent: its words add that a new link is needed. */
  it("words the backend's own last-owner refusal with the new link it needs, having asked the backend", async () => {
    const { row, token } = await verwaltendMitLink("zweite-inhaberin@example.org");
    loeschungAnswer = () => Response.json({ error_code: "last_owner_erasure", trace_id: "0".repeat(32) }, { status: 409 });

    const answer = await loescheKontoAction(token);

    expect(loeschungen.length, "the backend was never asked, so the refusal proves nothing").toBe(1);
    expect(answer.success ? "" : answer.error).toBe(`${LETZTE_INHABERIN} ${LINK_VERBRAUCHT}`);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
    assert.ok(
      !store.verification.some((held) => held.identifier === `delete-account-${token}`),
      "the link still stands, so the sentence asking for a new one is wrong",
    );
  });

  /* The backend's own window refused a press the page's check admitted at the window's edge, after the library
     spent the link: the page asks for the passkey, and its next press meets the spent link's own words. */
  it("answers the backend's confirmation refusal as the page's passkey prompt, the page's figures read again", async () => {
    const { row, token } = await verwaltendMitLink("verwaltung-backend-fenster@example.org");
    loeschungAnswer = () => Response.json({ error_code: "confirmation_required", trace_id: "0".repeat(32) }, { status: 401 });
    cacheCalls.length = 0;

    const answer = await loescheKontoAction(token);

    expect(loeschungen.length, "the backend was never asked, so the refusal proves nothing").toBe(1);
    expect(answer).toStrictEqual({ ...stepUpRequired(), error: `${stepUpRequired().error} ${LINK_VERBRAUCHT}` });
    assert.ok(
      cacheCalls.some(({ name }) => name === "refresh"),
      "the page's figures were not read again, so its next press would send unasked",
    );
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
  });

  it("reads no preview for a grant holder who owns nothing, who can be nobody's last owner", async () => {
    const { row, token } = await verwaltendMitLink("verwaltung-ohne-inhaberschaft@example.org", "administration");
    letzterInhaber = true;

    const answer = await loescheKontoAction(token);

    expect(answer.success, JSON.stringify(answer)).toBe(true);
    expect(ansichtReads).toBe(0);
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
  });

  it("refuses a link the library refuses, in words naming the fresh one, erasing nothing", async () => {
    const { row } = await mitLink("falscher-link@example.org");

    const answer = await loescheKontoAction("kein-gemailter-link");

    expect(answer.success ? "" : answer.error).toMatch(/Fordere auf Deiner Kontoseite einen neuen an\./);
    assert.ok(!answer.success && !answer.error.includes(LINK_VERBRAUCHT), "the link's own refusal says twice that a new one is needed");
    expect(loeschungen).toStrictEqual([]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
  });

  /* Every press mints a token row and mails a link, so the press counts on the address's own mail bound: past
     its fifth, it answers as sent and mints and mails nothing. */
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
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size, "a capped press answers apart from a mailed one").toBe(1);
    expect(mail.sent.filter((sent) => sent.to === email).length, "the address was mailed past its hour's five").toBe(5);
    expect(
      store.verification.filter((held) => held.identifier.startsWith("delete-account-") && held.value === row.userId).length,
      "a capped press minted a token row",
    ).toBe(5);
  });

  /* The link goes to the session's own mailbox, so a session past the step-up window still asks for one. */
  it("mails the link from a session signed in past the step-up window", async () => {
    const { cookie, row } = await sessionByCode(auth, store, "spaeter@example.org");
    row.createdAt = new Date(Date.now() - 3 * HOUR_MS);
    arriveAs(cookie);

    expect((await fordereKontoLoeschungAnAction()).success).toBe(true);
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
    assert(frisch !== null, "the grant holder's page read no step-up at all");
    expect(frisch.stepUp.holderId).toBe(row.userId);
    expect(frisch.hasPasskey).toBe(true);
    assert.ok(frisch.stepUp.enrolmentUntil !== null, "a passkey session of this moment read as past the window");

    arriveAs((await sessionByCode(auth, store, email)).cookie);
    const perPost = await readGrantHolderStepUp();
    assert(perPost !== null, "the grant holder's page read no step-up at all");
    expect(perPost.stepUp.holderId, "the prompt would check its assertion against another account").toBe(row.userId);
    expect(perPost.stepUp.enrolmentUntil, "a session the mailbox made read as inside the passkey window").toBe(null);
  });
});
