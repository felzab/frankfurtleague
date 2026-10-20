import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLKontoAdresswechselResponse } from "@/features/konto/schemas.ts";

/* The browser's own credential calls, which this runner has none of. */
registerDoubles({
  modules: { "core/authClient.ts": { authClient: { signIn: { passkey: () => Promise.resolve({ data: {}, error: null }) } } } },
});

const { calls, answerWith, answered } = doubleActions({
  modules: [/\/features\/konto\/personActions\.ts$/, /\/features\/konto\/actions\.ts$/],
});
const { raised } = doubleToasts();

const { AdresswechselPanel, AENDERUNG_FREIGEBEN, AENDERUNG_ZURUECKZIEHEN, E_MAIL_ADRESSE_AENDERN } = await import("./AdresswechselPanel.tsx");
const { ADRESSWECHSEL_STOPPEN } = await import("@/core/adresswechselAntworten.ts");
const { IDENTITY_CONFIRMATION_TITLE } = await import("@/shared/components/ui/IdentityConfirmation.tsx");

const MINUTE_MS = 60 * 1000;

const OHNE: FLKontoAdresswechselResponse = { acknowledged: 1, moeglich: true, offen: null };

/** The change the page was drawn for, which its approval names. */
const SHOWN = "6890a1b2c3d4e5f607800042";

/** A pending change as the read serves it, the new address already composed by the backend. */
const offen = (teil: Partial<NonNullable<FLKontoAdresswechselResponse["offen"]>>): FLKontoAdresswechselResponse => ({
  ...OHNE,
  offen: {
    id: SHOWN,
    email: "lena@neu.example",
    weg: "konto",
    wartet_auf: "neue_adresse",
    gueltig_bis: "2026-10-21T11:30:00Z",
    wirksam_ab: null,
    genehmigung: null,
    ...teil,
  },
});

/** The page's figures as the server read them: confirmed `vor` minutes ago, so inside the enrolment window or past it. */
const bestaetigung = (vor: number | null, verwaltung = false) => {
  const jetzt = Date.now();
  return {
    freshUntil: vor === null ? null : jetzt - vor * MINUTE_MS + 2 * 60 * MINUTE_MS,
    enrolmentUntil: vor === null || vor >= 5 ? null : jetzt - vor * MINUTE_MS + 5 * MINUTE_MS,
    servedAt: jetzt,
    hasPasskey: true,
    verwaltung: verwaltung,
    inhaberId: "inhaber",
    inhaberAdresse: "lena@schule.example",
  };
};

const panel = (adresswechsel: FLKontoAdresswechselResponse, vor: number | null, verwaltung = false) =>
  underNext(h(AdresswechselPanel, { adresswechsel: adresswechsel, bestaetigung: bestaetigung(vor, verwaltung) }));

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  answerWith(() => Promise.resolve({ success: true, message: "Bestätige die neue Adresse.", versand: "gesendet" }));
});

async function starte(vor: number | null): Promise<void> {
  const user = userEvent.setup();
  render(panel(OHNE, vor));
  await user.click(screen.getByRole("button", { name: E_MAIL_ADRESSE_AENDERN }));
  await user.type(screen.getByRole("textbox", { name: /Neue E-Mail-Adresse/ }), "lena@neu.example");
  await user.click(screen.getByRole("button", { name: "Link an neue Adresse senden" }));
}

describe("the account page's address control", () => {
  it("sends the start inside the enrolment window, and the typed address alone", async () => {
    await starte(1);
    await act(answered);

    assert.deepEqual(
      calls.map(({ action, payload }) => [action, payload]),
      [["starteAdresswechselAction", { email: "lena@neu.example" }]],
    );
  });

  /* The start hands the records over, so it asks a passkey or a code first (`docs/frontend/spec.md :: I806`). */
  it("asks for a confirmation first past the enrolment window, sending nothing", async () => {
    await starte(30);

    await waitFor(() => assert.ok(screen.getByRole("dialog", { name: IDENTITY_CONFIRMATION_TITLE })));
    assert.deepEqual(calls, []);
  });

  it("asks for the confirmation where the server refused the start for want of one", async () => {
    answerWith(() => Promise.resolve({ success: false, error: "Bestätige zuerst, dass Du es bist.", stepUp: true }));

    await starte(1);
    await act(answered);

    await waitFor(() => assert.ok(screen.getByRole("dialog", { name: IDENTITY_CONFIRMATION_TITLE })));
    assert.deepEqual(raised, [], "a refusal the page answers by asking raised a toast as well");
  });

  /* The page renders the address the backend composed and masks nothing itself: whole where the person typed it, so a
     typo is caught before a stranger confirms it, and masked where the league typed it, for an approver to recognise. */
  it("shows the pending address exactly as the read served it, whole or masked", () => {
    const { unmount } = render(panel(offen({}), null));
    assert.match(document.body.textContent, /Die neue E-Mail-Adresse lena@neu\.example wartet auf ihre Bestätigung/);
    unmount();

    render(panel(offen({ email: "m•••@g•••.de", weg: "freigabe", wartet_auf: "freigabe" }), null));
    assert.match(document.body.textContent, /für Dich eingetragen: m•••@g•••\.de\./);
  });

  it("offers the approval and the stop on a change awaiting approval, and asks for it only where asked for", () => {
    render(panel(offen({ email: "m•••@g•••.de", weg: "freigabe", wartet_auf: "freigabe" }), null));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [AENDERUNG_FREIGEBEN, ADRESSWECHSEL_STOPPEN],
    );
    assert.match(
      document.body.textContent,
      /Gib sie nur frei, wenn Du das selbst bei uns angefragt hast\. Freigeben kannst Du bis 21\. Oktober 2026 um 13:30\./,
    );
  });

  /* A second start replaces the change this page shows; the press names the shown one, so the backend approves nothing
     the page never displayed. */
  it("approves the change the page shows, by its id", async () => {
    render(panel(offen({ email: "m•••@g•••.de", weg: "freigabe", wartet_auf: "freigabe" }), 1));

    await userEvent.setup().click(screen.getByRole("button", { name: AENDERUNG_FREIGEBEN }));
    await act(answered);

    assert.deepEqual(
      calls.map(({ action, payload }) => [action, payload]),
      [["gibAdresswechselFreiAction", { id: SHOWN }]],
    );
  });

  /* Until another administrator approves, the address on file keeps its grant: the page says so, never that it is lost. */
  it("says a grant holder's change waits for another administrator, the address on file signing in meanwhile", () => {
    const { unmount } = render(
      panel(
        offen({ wartet_auf: "genehmigung", genehmigung: { verwaltung: "administration", genehmigt: false, bis: "2026-10-27T11:30:00Z" } }),
        null,
      ),
    );
    assert.match(
      document.body.textContent,
      /ist bestätigt\. Weil diese Adresse Zugang zur Verwaltung hat, muss außerdem eine andere Person aus der Verwaltung zustimmen, bis 27\. Oktober 2026 um 12:30\. Bis dahin meldest Du Dich weiter mit dieser Adresse an, mit vollem Zugang\./,
    );
    unmount();

    render(panel(offen({ genehmigung: { verwaltung: "owner", genehmigt: false, bis: "2026-10-27T11:30:00Z" } }), null));
    assert.match(document.body.textContent, /muss außerdem eine andere Inhaberin oder ein anderer Inhaber der Verwaltung zustimmen/);
  });

  it("says nothing of an approval already given", () => {
    render(panel(offen({ genehmigung: { verwaltung: "administration", genehmigt: true, bis: "2026-10-27T11:30:00Z" } }), null));

    assert.doesNotMatch(document.body.textContent, /zustimmen/);
  });

  it("tells a grant holder before the start that another administrator must agree", () => {
    const { unmount } = render(panel(OHNE, null, true));
    assert.match(
      document.body.textContent,
      /Weil diese Adresse Zugang zur Verwaltung hat, muss außerdem eine andere Person aus der Verwaltung zustimmen/,
    );
    unmount();

    render(panel(OHNE, null, false));
    assert.doesNotMatch(document.body.textContent, /Zugang zur Verwaltung/);
  });

  /* A stop hands nothing over, so it asks nothing, whatever the window. */
  it("takes the person's own start back without asking, the press their own word for it", async () => {
    render(panel(offen({}), null));

    await userEvent.setup().click(screen.getByRole("button", { name: AENDERUNG_ZURUECKZIEHEN }));
    await act(answered);

    assert.deepEqual(
      calls.map(({ action }) => action),
      ["stoppeAdresswechselAction"],
    );
  });
});
