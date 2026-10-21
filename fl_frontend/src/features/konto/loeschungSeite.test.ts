import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { registerDoubles } from "@/core/exportingModule.ts";
import { FLSelbstErasureAnsichtResponseSchema } from "@/core/schemas.ts";
import { person } from "@/core/subjectFixtures.ts";
import { doubleEveryAction, doubleSubjectLookup } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, clearSteps, EMPTIEST_ANSWER, pageBody, readsOf, steps } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactElement } from "react";
import type { GrantHolderStepUp, LoeschungAnsicht, LoeschungStart } from "./components/views/LoeschungView.tsx";
import type { GrantHolderReading } from "./loeschungStepUp.ts";

const { setSubject } = doubleSubjectLookup();
doubleEveryAction();

/** What the grant holder's session read answers, and how often the page asked it since the case began. */
let grantHolder: GrantHolderReading | null = null;
let grantReads = 0;

/* The read takes the sign-in store, which a page suite does not load: the session it reads is that store's
   own suite's to prove. */
registerDoubles({
  modules: {
    "features/konto/loeschungStepUp.ts": {
      readGrantHolderStepUp: () => ((grantReads += 1), Promise.resolve(grantHolder)),
    },
  },
});

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: LoeschungPage } = await import("@/app/(public)/loeschung/page.tsx");
const { LoeschungView } = await import("./components/views/LoeschungView.tsx");
const { LETZTE_INHABERIN } = await import("./refusals.ts");

const TOKEN = "kein-echtes-token";

/** One record of every kind the read serves, each list holding one. */
const ANSICHT: LoeschungAnsicht = {
  spieler: [{ vorname: "Pia", nachname: "Brandt" }],
  schiedsrichter: [{ name: "Pia Brandt" }],
  sitze: [{ saison_id: "2526", team_name: "Lessing Lions", rolle: "trainer", vorname: "Pia", nachname: "Brandt" }],
  bewerbungen: [{ saison_id: "2627", rolle: "ansprechperson", vorname: "Pia", nachname: "Brandt" }],
  registrierungen: [{ saison_id: "2627", team_name: "Goethe Gators", vorname: "Pia", nachname: "Brandt" }],
  adresswechsel: 1,
  verwaltung: "administration",
  letzter_inhaber: false,
};

/** The read's fields that say something of the press rather than name a record the erasure reaches. */
const NO_RECORD: ReadonlySet<string> = new Set(["acknowledged", "letzter_inhaber"]);

/** A grant holder past every window, as the read serves one. */
const PAST_EVERY_WINDOW: GrantHolderStepUp = { freshUntil: null, enrolmentUntil: null, servedAt: 0, holderId: "inhaberin" };

/** What the page hands its view for `searchParams`, the read answered with `ANSICHT`. */
async function opened(searchParams: Record<string, string>): Promise<{ start: LoeschungStart; stepUp?: GrantHolderStepUp | null }> {
  clearSteps();
  grantReads = 0;
  answerReadsWith((endpoint, schema, params) =>
    endpoint === "/identitaet/selbst/erasure/ansicht" ? { acknowledged: 1, ...ANSICHT } : EMPTIEST_ANSWER(endpoint, schema, params),
  );
  const body = (await pageBody(LoeschungPage, { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    start: LoeschungStart;
    stepUp?: GrantHolderStepUp | null;
  }>;

  return body.props;
}

const start = async (searchParams: Record<string, string>): Promise<LoeschungStart> => (await opened(searchParams)).start;

describe("what the deletion link's interstitial opens on (`docs/frontend/spec.md :: I677`)", () => {
  it("opens a link carrying no token on the incomplete link's panel, reading nothing", async () => {
    setSubject(person());

    assert.deepEqual(await start({}), { zustand: "unvollstaendig" });
    assert.deepEqual(readsOf(steps), []);
  });

  /* A mailed link may open in a browser holding no session, where the library would refuse the press anyway:
     the page sends it to sign in and has it open the link again, carrying no return destination. */
  it("asks a browser holding no session to sign in and open the link again, reading nothing", async () => {
    setSubject(null);

    assert.deepEqual(await start({ token: TOKEN }), { zustand: "anmelden" });
    assert.deepEqual(readsOf(steps), []);
  });

  /* The press asks for the passkey in the page, so a session the mailbox made is no reason to send a grant
     holder away to sign in (`docs/frontend/spec.md :: I707`). */
  it("hands a grant holder's press its passkey prompt, whichever factor signed the session in", async () => {
    setSubject(person({ verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z" }, false));
    grantHolder = { stepUp: PAST_EVERY_WINDOW, hasPasskey: true };

    assert.deepEqual(await opened({ token: TOKEN }), {
      start: { zustand: "bereit", token: TOKEN, email: "pia@example.org", ansicht: ANSICHT },
      stepUp: PAST_EVERY_WINDOW,
    });
  });

  it("sends a grant holder holding no passkey to set one up, reading nothing", async () => {
    setSubject(person({ verwaltung: "owner", berechtigt_seit: "2026-01-01T00:00:00Z", inhaber_seit: "2026-01-01T00:00:00Z" }, false));
    grantHolder = { stepUp: PAST_EVERY_WINDOW, hasPasskey: false };

    assert.deepEqual(await start({ token: TOKEN }), { zustand: "ohnePasskey" });
    assert.deepEqual(readsOf(steps), []);
  });

  it("hands a signed-in person the records the backend's erasure would reach, with the link's token, asking for no passkey", async () => {
    setSubject(person());

    assert.deepEqual(await opened({ token: TOKEN }), {
      start: { zustand: "bereit", token: TOKEN, email: "pia@example.org", ansicht: ANSICHT },
      stepUp: null,
    });
    assert.equal(grantReads, 0, "a person's page read a grant holder's session");
  });
});

describe("what the interstitial restates before the press", () => {
  const html = (zustand: LoeschungStart): string => renderTree(underNext(h(LoeschungView, { start: zustand })));
  const shown = (zustand: LoeschungStart): string =>
    textOf(html(zustand), " ")
      .replace(/\s+/g, " ")
      .replace(/ ([:,.])/g, "$1");
  const BEREIT: LoeschungStart = { zustand: "bereit", token: TOKEN, email: "pia@example.org", ansicht: ANSICHT };

  it("names every record that goes in the account page's words, the account first, and that nothing brings it back, above the press", () => {
    const text = shown(BEREIT);

    for (const zeile of [
      "Dein Konto pia@example.org mit Deinen Passkeys und Anmeldungen",
      "Als Spielerin oder Spieler: Pia Brandt",
      "Als Schiedsrichterin oder Schiedsrichter: Pia Brandt",
      "Als Trainerin oder Trainer: Lessing Lions, Saison 2526",
      "Als Ansprechperson: Bewerbung für die Saison 2627",
      "Als Spielerin oder Spieler: Registrierung für Goethe Gators, Saison 2627",
      "Eine laufende Adressänderung auf Deine Adresse",
      "Dein Zugang zur Verwaltung",
      // Named whatever the read found, as the log's: the erasure removes the reasons the address typed, and no count says so.
      "Deine Begründungen zu Spielterminen, die Du über einen Bestätigungslink abgegeben hast",
      // Named whatever the read found: the erasure rewrites the log and the address's authorship, and no count says so.
      "Deine Adresse im Änderungsprotokoll und als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen",
      "Zurückholen lässt sich das nicht.",
    ]) {
      assert.ok(text.includes(zeile), `the page does not say „${zeile}“`);
    }
    assert.ok(
      text.indexOf("Zurückholen lässt sich das nicht.") < text.indexOf("Konto endgültig löschen"),
      "the press stands above what it destroys",
    );
  });

  /* Read off the mirror rather than listed here: a kind the read gains with no line would be erased unannounced. */
  it("draws a line for every kind of record the read serves", () => {
    const fields = Object.keys(FLSelbstErasureAnsichtResponseSchema.shape);
    assert.deepEqual(
      fields.filter((key) => key !== "acknowledged").toSorted(),
      Object.keys(ANSICHT).toSorted(),
      "the read serves a field this case holds no value of",
    );

    // The account's own line, the reasons' and the log's beside one per kind.
    assert.equal([...html(BEREIT).matchAll(/<li[ >]/g)].length, fields.filter((key) => !NO_RECORD.has(key)).length + 3);
  });

  /* The press would be refused, so the page offers none: one sentence serves the page and the refusal, and the
     link stays unspent for when another owner is made (`docs/frontend/spec.md :: I708`). */
  it("tells the league's last owner why, in place of the press, and still says what would go", () => {
    const text = shown({ ...BEREIT, ansicht: { ...ANSICHT, verwaltung: "owner", letzter_inhaber: true } });

    assert.ok(!text.includes("Konto endgültig löschen"), "the last owner is offered a press the action refuses");
    assert.ok(text.includes(LETZTE_INHABERIN), "the page does not say why it offers no press");
    assert.ok(text.includes("Dein Zugang zur Verwaltung"), "the list of what would go was dropped with the press");
  });

  for (const zustand of ["anmelden", "ohnePasskey"] as const) {
    it(`offers ${zustand === "anmelden" ? "a browser holding no session" : "a grant holder holding no passkey"} the sign-in and no press`, () => {
      const markup = html({ zustand: zustand });

      assert.ok(!textOf(markup, " ").includes("Konto endgültig löschen"), "a page that cannot complete offers the press");
      assert.match(markup, /href="\/signin"/);
    });
  }
});
