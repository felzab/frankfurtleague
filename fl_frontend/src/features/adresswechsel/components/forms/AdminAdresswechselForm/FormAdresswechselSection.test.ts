import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { VerwaltungAnsichtGelesen } from "@/features/adresswechsel/queries.ts";
import type { FLAdresswechselVerwaltungAnsichtResponse } from "@/features/adresswechsel/schemas.ts";

/* Every read and write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answerPending, answered, calls } = doubleActions({
  modules: ["/src/features/adresswechsel/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ANZEIGEN, FormAdresswechselSection, NEUE_ADRESSE_EINTRAGEN } = await import("./FormAdresswechselSection.tsx");
const { ADRESSWECHSEL_EINTRAG } = await import("@/features/admin/constants.ts");

const ADRESSE = "lena@schule.example";

const ANSICHT: FLAdresswechselVerwaltungAnsichtResponse = {
  acknowledged: 1,
  adresse: ADRESSE,
  bestand: { spieler: 2, schiedsrichter: 1, sitze: 0, bewerbungssitze: 0, registrierungen: 0, berechtigung: "administration" },
  moeglich: true,
  offen: null,
};

const gelesen = (ansicht: FLAdresswechselVerwaltungAnsichtResponse): VerwaltungAnsichtGelesen => ({ status: "read", ansicht });

const tool = (anfang: VerwaltungAnsichtGelesen | null = null) =>
  render(underNext(h(FormAdresswechselSection, { anfang }), { search: "saison_id=2026" }));

const shown = (): string => (document.body.textContent ?? "").replace(/\s+/g, " ");

const box = () => screen.getByRole("textbox", { name: "Bisherige E-Mail-Adresse" });

beforeEach(() => {
  calls.length = 0;
});

describe("what the address tool reads", () => {
  /* Keyed by the address a person writes from: nothing is read until the administrator names one. */
  it("reads nothing until an address is shown, then the address typed", async () => {
    answerWith(() => Promise.resolve({ success: true, ansicht: ANSICHT }));
    const user = userEvent.setup();
    const { unmount } = tool();

    assert.equal(calls.length, 0, "the tool read before an address was shown");
    await user.type(box(), ` ${ADRESSE} `);
    await user.click(screen.getByRole("button", { name: ANZEIGEN }));
    await act(answered);

    assert.deepEqual(
      calls.map((call) => [call.action, call.payload]),
      [["readAdresswechselAnsichtAction", { adresse: ADRESSE }]],
    );
    unmount();
  });

  /* A person who can still sign in changes it on their account page. Said as their word: the tool's first way asks the
     address on file, which approves only where someone still signs in there. */
  it("asks for the address of a person who says they can no longer sign in with it, as its menu entry does", () => {
    tool();

    assert.match(shown(), /mit der sie sich nach eigener Angabe nicht mehr anmelden kann\./);
    assert.doesNotMatch(shown(), /nutzen will/);
    assert.equal(ADRESSWECHSEL_EINTRAG.hint.lead, "Die E-Mail-Adresse einer Person ändern, die sagt, dass sie sich nicht mehr anmelden kann.");
  });

  it("refuses a malformed address on its box, reading nothing", async () => {
    const user = userEvent.setup();
    const { unmount } = tool();

    await user.type(box(), "keine-adresse{Enter}");

    assert.equal(calls.length, 0, "the tool read a malformed address");
    assert.equal(box().getAttribute("aria-invalid"), "true");
    unmount();
  });

  it("lists what the address holds, each count spelled whole, and the grant it carries", () => {
    const { unmount } = tool(gelesen(ANSICHT));

    assert.match(shown(), /2 Einträge als Spielerin oder Spieler/);
    assert.match(shown(), /Ein bestätigter Eintrag als Schiedsrichterin oder Schiedsrichter/);
    assert.match(shown(), /Zugang zur Verwaltung/);
    assert.doesNotMatch(shown(), /Kontakt/, "a count of none is listed");
    unmount();
  });

  /* The start is offered by the read alone: an address holding nothing a change moves has nothing to start. */
  it("says an address holding nothing so, and offers no start there", () => {
    const { unmount } = tool(
      gelesen({ ...ANSICHT, bestand: { ...ANSICHT.bestand, spieler: 0, schiedsrichter: 0, berechtigung: null }, moeglich: false }),
    );

    assert.match(shown(), /Unter dieser Adresse steht nichts, dessen Adresse sich hier ändern lässt\./);
    assert.equal(screen.queryAllByRole("button", { name: NEUE_ADRESSE_EINTRAGEN }).length, 0);
    unmount();
  });

  /* A refusal is the answer, not a failed read: it stands alone, never behind an invitation to load again. */
  it("shows a read the backend refused in its own words, and any other failure as the read's", async () => {
    const user = userEvent.setup();
    const { unmount } = tool();
    await user.type(box(), ADRESSE);

    answerWith(() => Promise.resolve({ success: false, error: "Deine eigene Adresse änderst Du nicht hier, sondern auf Deiner Kontoseite." }));
    await user.click(screen.getByRole("button", { name: ANZEIGEN }));
    await act(answered);
    await waitFor(() => assert.match(shown(), /Deine eigene Adresse änderst Du nicht hier/));
    assert.doesNotMatch(shown(), /konnte nicht geladen werden/);

    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    await user.click(screen.getByRole("button", { name: ANZEIGEN }));
    await act(answered);
    await waitFor(() => assert.match(shown(), /Die Übersicht konnte nicht geladen werden\./));
    unmount();
  });

  /* Typing another address makes what was read speak of the wrong person, so it goes, and a late answer for it stays out. */
  it("drops what was read once the address changes, and shows no answer arriving for the address before", async () => {
    const user = userEvent.setup();
    const { unmount } = tool();
    await user.type(box(), ADRESSE);
    await user.click(screen.getByRole("button", { name: ANZEIGEN }));
    await user.type(box(), "x");
    answerPending({ success: true, ansicht: ANSICHT });
    await act(answered);

    assert.doesNotMatch(shown(), /Was unter der Adresse steht/);
    unmount();
  });
});

describe("the start box above the tool's reads", () => {
  /* A reason dropped while its way stands would start a change asking the lost mailbox. */
  it("keeps the way and the reason typed through a read of the same address", async () => {
    answerWith(() => Promise.resolve({ success: true, ansicht: ANSICHT }));
    const user = userEvent.setup();
    const { unmount } = tool(gelesen(ANSICHT));

    await user.click(screen.getByRole("button", { name: NEUE_ADRESSE_EINTRAGEN }));
    await user.click(screen.getByRole("radio", { name: "Die bisherige Adresse ist nicht mehr erreichbar" }));
    await user.type(screen.getByRole("textbox", { name: "Grund" }), "Postfach gelöscht");
    await user.click(screen.getByRole("button", { name: ANZEIGEN }));
    await act(answered);

    await waitFor(() => assert.equal((screen.getByRole("textbox", { name: "Grund" }) as HTMLInputElement).value, "Postfach gelöscht"));
    assert.equal(screen.getByRole("radio", { name: "Die bisherige Adresse ist nicht mehr erreichbar" }).getAttribute("aria-checked"), "true");
    unmount();
  });

  it("says the start ends the change shown where one stands at the address", async () => {
    const offen = {
      id: "68c1f0a2b3c4d5e6f7a8b9e0",
      email: "lena@neu.example",
      weg: "konto" as const,
      grund: null,
      wartet_auf: "neue_adresse" as const,
      verschickt_am: "2026-10-01",
      gueltig_bis: "2099-12-31T11:30:00Z",
      freigegeben_am: null,
      bestaetigt_am: null,
      wirksam_ab: null,
      zustellung: null,
      abgelaufen: false,
      genehmigung: null,
    };
    const { unmount } = tool(gelesen({ ...ANSICHT, offen }));

    await userEvent.setup().click(screen.getByRole("button", { name: NEUE_ADRESSE_EINTRAGEN }));

    assert.match(shown(), /Eine neue Änderung beendet die oben gezeigte/);
    unmount();
  });
});
