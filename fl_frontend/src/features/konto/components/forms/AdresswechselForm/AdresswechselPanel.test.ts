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

const OHNE: FLKontoAdresswechselResponse = { acknowledged: 1, moeglich: true, bleibt_verwaltung: false, offen: null };

/** The page's figures as the server read them: confirmed `vor` minutes ago, so inside the enrolment window or past it. */
const bestaetigung = (vor: number | null) => {
  const jetzt = Date.now();
  return {
    freshUntil: vor === null ? null : jetzt - vor * MINUTE_MS + 2 * 60 * MINUTE_MS,
    enrolmentUntil: vor === null || vor >= 5 ? null : jetzt - vor * MINUTE_MS + 5 * MINUTE_MS,
    servedAt: jetzt,
    hasPasskey: true,
    verwaltung: false,
    inhaberId: "inhaber",
    inhaberAdresse: "lena@schule.example",
  };
};

const panel = (adresswechsel: FLKontoAdresswechselResponse, vor: number | null) =>
  underNext(h(AdresswechselPanel, { adresswechsel: adresswechsel, bestaetigung: bestaetigung(vor) }));

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

  /* The start hands the records over, so it asks a passkey or a code first (`docs/frontend/spec.md :: I411`). */
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

  /* The pending address is never shown on the side of the address on file: it may be a pretext's target. */
  it("offers the approval and the stop on a change awaiting approval, naming no address", () => {
    render(panel({ ...OHNE, offen: { weg: "freigabe", wartet_auf: "freigabe", gueltig_bis: "2026-10-21T11:30:00Z", wirksam_ab: null } }, null));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [AENDERUNG_FREIGEBEN, ADRESSWECHSEL_STOPPEN],
    );
    assert.match(document.body.textContent, /Freigeben kannst Du bis 21\. Oktober 2026 um 13:30\./);
    assert.doesNotMatch(document.body.textContent, /@/);
  });

  /* A stop hands nothing over, so it asks nothing, whatever the window. */
  it("takes the person's own start back without asking, the press their own word for it", async () => {
    render(
      panel({ ...OHNE, offen: { weg: "konto", wartet_auf: "neue_adresse", gueltig_bis: "2026-10-21T11:30:00Z", wirksam_ab: null } }, null),
    );

    await userEvent.setup().click(screen.getByRole("button", { name: AENDERUNG_ZURUECKZIEHEN }));
    await act(answered);

    assert.deepEqual(
      calls.map(({ action }) => action),
      ["stoppeAdresswechselAction"],
    );
  });
});
