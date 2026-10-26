import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
    abgelaufen: false,
    ...teil,
  },
});

/** The page's figures as the server read them: confirmed `vor` minutes ago, so inside the enrolment window or past it. */
const bestaetigung = (vor: number | null, verwaltung: "owner" | "administration" | null = null) => {
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

const panel = (adresswechsel: FLKontoAdresswechselResponse, vor: number | null, verwaltung: "owner" | "administration" | null = null) =>
  underNext(h(AdresswechselPanel, { adresswechsel: adresswechsel, bestaetigung: bestaetigung(vor, verwaltung) }));

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  answerWith(() => Promise.resolve({ success: true, message: "Bestätige die neue Adresse.", versand: "gesendet" }));
});

async function starte(vor: number | null, verwaltung: "owner" | "administration" | null = null): Promise<void> {
  const user = userEvent.setup();
  render(panel(OHNE, vor, verwaltung));
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

  /* The administrator's guard admits a grant's address by passkey alone, so a code would confirm a session it refuses. */
  it("offers a grant's address the passkey alone, and any other the code beside it", async () => {
    await starte(30, "administration");
    await waitFor(() => assert.ok(screen.getByRole("dialog", { name: IDENTITY_CONFIRMATION_TITLE })));
    assert.equal(screen.queryAllByRole("button", { name: "Code per E-Mail senden" }).length, 0, "a grant's address is offered a code");
    cleanup();

    await starte(30);
    await waitFor(() => assert.ok(screen.getByRole("button", { name: "Code per E-Mail senden" })));
  });

  it("asks for the confirmation where the server refused the start for want of one", async () => {
    answerWith(() => Promise.resolve({ success: false, error: "Bestätige zuerst, dass Du es bist.", stepUp: true }));

    await starte(1);
    await act(answered);

    await waitFor(() => assert.ok(screen.getByRole("dialog", { name: IDENTITY_CONFIRMATION_TITLE })));
    assert.deepEqual(raised, [], "a refusal the page answers by asking raised a toast as well");
  });

  /* A start or an approval whose answer never came may have mailed its link: the title names the link, and the body
     sends the person to the reloaded page, which shows the change wherever it stood. */
  it("says a start or an approval nobody can tell landed may have sent its link, and marks no field", async () => {
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    const unklar = [
      "Unklar, ob der Link verschickt wurde",
      "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.",
      "unknown",
    ];

    await starte(1);
    await act(answered);
    await waitFor(() =>
      assert.deepEqual(
        raised.map(({ variant, title, description, options }) => [variant, title, description, options?.outcome]),
        [["danger", ...unklar]],
      ),
    );
    assert.equal(screen.getByRole("textbox", { name: /Neue E-Mail-Adresse/ }).getAttribute("aria-invalid"), null);
    cleanup();
    raised.length = 0;

    render(panel(offen({ email: "m•••@g•••.de", weg: "freigabe", wartet_auf: "freigabe" }), 1));
    await userEvent.setup().click(screen.getByRole("button", { name: AENDERUNG_FREIGEBEN }));
    await act(answered);
    await waitFor(() =>
      assert.deepEqual(
        raised.map(({ variant, title, description, options }) => [variant, title, description, options?.outcome]),
        [["danger", ...unklar]],
      ),
    );
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
      /ist bestätigt\. Weil Deine bisherige Adresse Zugang zur Verwaltung hat, muss außerdem eine andere Person aus der Verwaltung zustimmen, bis 27\. Oktober 2026 um 12:30\. Bis zur Zustimmung meldest Du Dich weiter mit Deiner bisherigen Adresse an, mit vollem Zugang\./,
    );
    unmount();

    render(panel(offen({ genehmigung: { verwaltung: "owner", genehmigt: false, bis: "2026-10-27T11:30:00Z" } }), null));
    assert.match(document.body.textContent, /muss außerdem eine andere Inhaberin oder ein anderer Inhaber der Verwaltung zustimmen/);
  });

  /* „Bis dahin gilt diese.“ read as the new address, and after the link's deadline: the old address holds until the confirmation. */
  it("names the address that holds until the confirmation, never the link's deadline as its end", () => {
    const { unmount } = render(panel(offen({}), null));
    assert.match(
      document.body.textContent,
      /wartet auf ihre Bestätigung, längstens bis 21\. Oktober 2026 um 13:30\. Bis zur Bestätigung gilt Deine bisherige Adresse\./,
    );
    unmount();

    render(panel(offen({ wartet_auf: "wartezeit", gueltig_bis: null, wirksam_ab: "2026-10-28T11:30:00Z" }), null));
    assert.match(document.body.textContent, /gilt ab 28\. Oktober 2026 um 12:30\. Bis dahin gilt Deine bisherige Adresse\./);
    assert.doesNotMatch(document.body.textContent, /gilt diese/);
  });

  it("says nothing of an approval already given", () => {
    render(panel(offen({ genehmigung: { verwaltung: "administration", genehmigt: true, bis: "2026-10-27T11:30:00Z" } }), null));

    assert.doesNotMatch(document.body.textContent, /zustimmen/);
  });

  /* An owner told that any administrator may approve asks one, whose press is closed: the tier names the approver. */
  it("tells a grant holder before the start who must agree, by the tier the grant holds", () => {
    const { unmount } = render(panel(OHNE, null, "administration"));
    assert.match(
      document.body.textContent,
      /Weil diese Adresse Zugang zur Verwaltung hat, muss außerdem eine andere Person aus der Verwaltung zustimmen/,
    );
    unmount();

    const owner = render(panel(OHNE, null, "owner"));
    assert.match(document.body.textContent, /muss außerdem eine andere Inhaberin oder ein anderer Inhaber der Verwaltung zustimmen/);
    owner.unmount();

    render(panel(OHNE, null, null));
    assert.doesNotMatch(document.body.textContent, /Zugang zur Verwaltung/);
  });

  /* The backend refuses a lapsed step's approval until the hourly pass ends the change, and a start replaces it. */
  it("offers a lapsed change's start in place of its approval and its stop, naming no deadline past", async () => {
    const user = userEvent.setup();
    render(panel(offen({ email: "m•••@g•••.de", weg: "freigabe", wartet_auf: "freigabe", abgelaufen: true }), 1));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [E_MAIL_ADRESSE_AENDERN],
    );
    assert.match(document.body.textContent, /Die Änderung auf die neue E-Mail-Adresse m•••@g•••\.de ist abgelaufen\./);
    assert.doesNotMatch(document.body.textContent, /Freigeben kannst Du bis/);

    await user.click(screen.getByRole("button", { name: E_MAIL_ADRESSE_AENDERN }));
    await user.type(screen.getByRole("textbox", { name: /Neue E-Mail-Adresse/ }), "lena@neu.example");
    await user.click(screen.getByRole("button", { name: "Link an neue Adresse senden" }));
    await act(answered);

    assert.deepEqual(
      calls.map(({ action, payload }) => [action, payload]),
      [["starteAdresswechselAction", { email: "lena@neu.example" }]],
    );
  });

  /* The person confirmed, and was told the change waits on the administration: the lapse names that step. */
  it("says a confirmed change lapsed on the administration's approval, never the deadline it passed", () => {
    const genehmigung = { verwaltung: "administration" as const, genehmigt: false, bis: "2026-10-20T11:30:00Z" };
    // Waiting on its approval alone, and on a waiting time besides: both were confirmed.
    for (const wartend of [{ wartet_auf: "genehmigung" as const }, { wartet_auf: "wartezeit" as const, wirksam_ab: "2026-10-27T11:30:00Z" }]) {
      const { unmount } = render(panel(offen({ ...wartend, gueltig_bis: null, genehmigung: genehmigung, abgelaufen: true }), null));

      assert.match(
        document.body.textContent,
        /Die Änderung auf die neue E-Mail-Adresse lena@neu\.example ist abgelaufen, weil die Verwaltung ihr nicht rechtzeitig zugestimmt hat\./,
        wartend.wartet_auf,
      );
      assert.doesNotMatch(document.body.textContent, /zustimmen, bis|gilt ab/, wartend.wartet_auf);
      unmount();
    }
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
