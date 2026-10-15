import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { FLSelbstErasureAnsichtResponseSchema } from "@/core/schemas.ts";
import { person } from "@/core/subjectFixtures.ts";
import { doubleEveryAction, doubleSubjectLookup } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, clearSteps, EMPTIEST_ANSWER, pageBody, readsOf, steps } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactElement } from "react";
import type { LoeschungAnsicht, LoeschungStart } from "./components/views/LoeschungView.tsx";

const { setSubject } = doubleSubjectLookup();
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: LoeschungPage } = await import("@/app/(public)/loeschung/page.tsx");
const { LoeschungView } = await import("./components/views/LoeschungView.tsx");

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
};

/** What the page hands its view for `searchParams`, the read answered with `ANSICHT`. */
async function start(searchParams: Record<string, string>): Promise<LoeschungStart> {
  clearSteps();
  answerReadsWith((endpoint, schema, params) =>
    endpoint === "/identitaet/selbst/erasure/ansicht" ? { acknowledged: 1, ...ANSICHT } : EMPTIEST_ANSWER(endpoint, schema, params),
  );
  const body = (await pageBody(LoeschungPage, { params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    start: LoeschungStart;
  }>;

  return body.props.start;
}

describe("what the deletion link's interstitial opens on (`docs/frontend/spec.md :: I_NEW_S9-AUTH_4`)", () => {
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

  it("asks an address holding a grant to sign in by its passkey where its session came by mail", async () => {
    setSubject(person({ verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z" }, false));

    assert.deepEqual(await start({ token: TOKEN }), { zustand: "anmelden" });
  });

  it("hands a signed-in person the records the backend's erasure would reach, with the link's token", async () => {
    setSubject(person());

    assert.deepEqual(await start({ token: TOKEN }), { zustand: "bereit", token: TOKEN, email: "pia@example.org", ansicht: ANSICHT });
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
      "Eine noch nicht bestätigte Adressänderung auf Deine Adresse",
      "Dein Zugang zur Verwaltung",
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
    const kinds = Object.keys(FLSelbstErasureAnsichtResponseSchema.shape).filter((key) => key !== "acknowledged");
    assert.deepEqual(kinds.toSorted(), Object.keys(ANSICHT).toSorted(), "the read serves a kind this case holds no record of");

    // The account's own line beside one per kind.
    assert.equal([...html(BEREIT).matchAll(/<li[ >]/g)].length, kinds.length + 1);
  });

  it("offers a browser holding no session the sign-in and no press", () => {
    const markup = html({ zustand: "anmelden" });

    assert.ok(!textOf(markup, " ").includes("Konto endgültig löschen"), "a page with no session offers the press");
    assert.match(markup, /href="\/signin"/);
  });
});
