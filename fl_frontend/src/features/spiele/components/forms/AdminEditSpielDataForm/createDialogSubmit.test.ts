import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pickerTrigger } from "@/shared/testing/pickerTrigger.ts";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";
import type { FLSpielort } from "@/features/spielorte/schemas.ts";

// One answer serves a venue create and a match save alike, so a save the dialog set off would be answered and seen.
const { calls, answered, answerWith } = doubleActions({
  modules: ["/src/features/spiele/actions.ts", "/src/features/spielorte/actions.ts", "/src/features/schiedsrichter/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", priorPaarungen: [], created_id: "6890a1b2c3d4e5f607800099" }),
});
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

const side = (team_id: string, name: string, shorthand: string) => ({ team_id, tore: null, name, shorthand, austritt_type: null });

const SPIEL: FLSpielAdmin = {
  id: "6890a1b2c3d4e5f607182901",
  spieltag_id: "6890a1b2c3d4e5f607182990",
  team1: side("68c1f0a2b3c4d5e6f7a8b9c1", "SG Alpha", "SA"),
  team2: side("68c1f0a2b3c4d5e6f7a8b9c2", "SG Beta", "SB"),
  team1_quelle: null,
  team2_quelle: null,
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2026",
  notiz: null,
  ansetzung_bestaetigt: null,
};

/** One venue the league holds, so the list offers its footer's create rather than the empty state's. */
const VENUE: FLSpielort = {
  id: "6890a1b2c3d4e5f607800021",
  name: "Sportpark Nord",
  address: { strasse: "Nordweg", hausnummer: "2", plz: "60433", stadt: "Frankfurt am Main", stadtteil: "Eschersheim" },
  maps_link: "Sportpark Nord, Nordweg 2, 60433 Frankfurt am Main",
  default_mietpreis: 30,
  inactive_since: null,
};

/** A referee who confirmed their own entry, which alone a fixture can be booked to. */
const REFEREE: FLSchiedsrichter = {
  id: "6890a1b2c3d4e5f607800031",
  name: "Erika Muster",
  schule: null,
  default_payment: 20,
  kontakt: { telefon: null, email: "erika.muster@example.org" },
  inactive_since: null,
  geburtsdatum: "2007-03-01",
  einwilligung: {
    umfang: "kader_oeffentlich",
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-01",
    text_version: "2026-10-schiedsrichterseite-4",
    medien: false,
    nachweis: { umfang: null, medien: null },
  },
  bestaetigung: null,
};

const CREATED_REFEREE = "Jonas Weber";

const CREATED_VENUE = "Turnhalle Riedberg";

/** The editor with a note typed into its draft, so a save the dialog set off would carry it. */
async function renderEditor(
  user: ReturnType<typeof userEvent.setup>,
  { spielorte = [VENUE], schiedsrichter = [] }: { spielorte?: FLSpielort[]; schiedsrichter?: FLSchiedsrichter[] } = {},
): Promise<void> {
  render(
    underNext(
      h(AdminEditSpielDataForm, {
        spielData: SPIEL,
        teams: [],
        spielorte,
        schiedsrichter,
        saisonSpiele: [SPIEL],
        numberOfGroups: 2,
        isFinishedSaison: false,
        isActiveSaison: true,
        isSpielSweepOn: true,
        today: "2026-09-14",
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );
  await user.type(screen.getByRole("textbox", { name: "Notiz zum Spiel" }), "Halle getauscht");
}

async function openVenueDialog(user: ReturnType<typeof userEvent.setup>, create: RegExp): Promise<HTMLElement> {
  await user.click(pickerTrigger("Spielort"));
  await user.click(await screen.findByRole("button", { name: create }));
  return screen.findByRole("dialog", { name: "Spielort anlegen" });
}

/** The referee dialog opened from the picker, filled in and saved, its create answered with how its link ended. */
async function createReferee(user: ReturnType<typeof userEvent.setup>, versand: string, message: string): Promise<void> {
  await user.click(pickerTrigger("Schiedsrichter"));
  await user.click(await screen.findByRole("button", { name: /Neuen Schiedsrichter anlegen/ }));
  const dialog = await screen.findByRole("dialog", { name: "Schiedsrichter anlegen" });
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), CREATED_REFEREE);
  await user.type(within(dialog).getByRole("textbox", { name: "E-Mail" }), "jonas.weber@example.org");
  await user.type(within(dialog).getByRole("textbox", { name: "Standard-Honorar" }), "20");
  answerWith(() => Promise.resolve({ success: true, message, created_id: "6890a1b2c3d4e5f607800099", versand }));
  calls.length = 0;
  toasts.length = 0;

  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
}

async function fillVenue(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<void> {
  const field = (name: string) => within(dialog).getByRole("textbox", { name });
  await user.type(field("Name"), CREATED_VENUE);
  await user.type(field("Straße"), "Musterweg");
  await user.type(field("Nr."), "1");
  await user.type(field("PLZ"), "60311");
  await user.type(field("Stadtteil"), "Riedberg");
  await user.type(field("Standard Mietpreis"), "40");
}

/** Every write the press set off, a save a create's answer would chain included. */
async function sent(): Promise<string[]> {
  await act(answered);
  await act(async () => {
    await settled();
  });
  await act(answered);
  return calls.map((call) => call.action);
}

describe("a create dialog the match editor opens", () => {
  /* The editor's save would carry the draft as it stood before the dialog opened, written once before
     the create and once after it (`docs/frontend/spec.md :: I711`). */
  it("sends the venue create alone when its own Speichern is pressed, and books the new venue", async () => {
    const user = userEvent.setup();
    await renderEditor(user);
    const dialog = await openVenueDialog(user, /Neuen Spielort anlegen/);
    await fillVenue(user, dialog);
    calls.length = 0;

    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));

    assert.deepEqual(await sent(), ["postSpielortAction"], "the venue dialog's submit sent the match editor's save as well");
    assert.ok(
      pickerTrigger("Spielort").textContent?.includes(CREATED_VENUE),
      "the created venue is not booked on the fixture, so a save books none",
    );
  });

  it("sends the venue create alone on an Enter in its name field", async () => {
    const user = userEvent.setup();
    await renderEditor(user);
    const dialog = await openVenueDialog(user, /Neuen Spielort anlegen/);
    await fillVenue(user, dialog);
    calls.length = 0;

    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "{Enter}");

    assert.deepEqual(await sent(), ["postSpielortAction"], "the venue dialog's Enter sent the match editor's save as well");
  });

  /* Its own block refuses the empty draft, so any write at all came from the editor's save. */
  it("sends nothing when the empty referee dialog's Speichern is pressed", async () => {
    const user = userEvent.setup();
    await renderEditor(user, { schiedsrichter: [REFEREE] });
    await user.click(pickerTrigger("Schiedsrichter"));
    await user.click(await screen.findByRole("button", { name: /Neuen Schiedsrichter anlegen/ }));
    const dialog = await screen.findByRole("dialog", { name: "Schiedsrichter anlegen" });
    calls.length = 0;

    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));

    assert.deepEqual(await sent(), [], "the empty referee dialog's submit sent a write");
  });

  /* A referee just created is unconfirmed, and the save refuses an unconfirmed referee: booking it would offer a save
     that cannot succeed. Listed rather than hidden, and the toast says why the picker stays empty. */
  it("lists a referee it creates as not yet confirmed, and books none", async () => {
    const user = userEvent.setup();
    await renderEditor(user, { schiedsrichter: [REFEREE] });
    await createReferee(user, "gesendet", "Der Bestätigungslink ging an jonas.weber@example.org.");

    assert.deepEqual(await sent(), ["postSchiedsrichterAction"], "the referee dialog's submit sent the match editor's save as well");
    assert.ok(!pickerTrigger("Schiedsrichter").textContent?.includes(CREATED_REFEREE), "the created referee is booked on the fixture");
    await user.click(pickerTrigger("Schiedsrichter"));
    const row = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .find((option) => option.textContent?.startsWith(CREATED_REFEREE) === true);
    assert.equal(row?.getAttribute("aria-disabled"), "true", "the created referee is not listed, or listed as pickable");
    assert.deepEqual(
      toasts.map(({ variant, title }) => [variant, title]),
      [["success", "Angelegt. Einteilen kannst Du die Person, sobald sie ihren Eintrag bestätigt hat."]],
    );
  });

  /* A link that did not go out titles the toast for itself, and every stack that mails nothing withholds it: the
     reason the picker stays empty is said after the link's sentence rather than dropped with the clean title. */
  it("says why it booked none when the link did not go out", async () => {
    const user = userEvent.setup();
    await renderEditor(user, { schiedsrichter: [REFEREE] });
    await createReferee(user, "zurueckgehalten", "Die Nachricht wurde nur abgelegt.");

    assert.deepEqual(await sent(), ["postSchiedsrichterAction"], "the referee dialog's submit sent the match editor's save as well");
    assert.deepEqual(
      toasts.map(({ variant, title, description }) => [variant, title, description]),
      [
        [
          "warning",
          "Mit Folgen angelegt",
          "Die Nachricht wurde nur abgelegt. Einteilen kannst Du die Person, sobald sie ihren Eintrag bestätigt hat.",
        ],
      ],
    );
  });

  /* react-stately opens no select over an empty list, which left a league with no venue no way to its first. */
  it("opens over a league holding no venue and reaches the create dialog", async () => {
    const user = userEvent.setup();
    await renderEditor(user, { spielorte: [] });

    await openVenueDialog(user, /Jetzt anlegen/);
  });
});

describe("the referee the match editor's save says it was served", () => {
  /* The stand is the referee the editor loaded, never its pick: read off the draft, every booking would claim the
     fixture already held the referee it picks, which the save refuses as the slot having moved (`REQ-BOOKING-003`). */
  it("sends the stored slot beside the referee picked", async () => {
    const user = userEvent.setup();
    await renderEditor(user, { schiedsrichter: [REFEREE] });
    await user.click(pickerTrigger("Schiedsrichter"));
    const row = within(await screen.findByRole("listbox"))
      .getAllByRole("option")
      .find((option) => option.textContent?.startsWith("Erika Muster") === true);
    await user.click(row ?? assert.fail("the confirmed referee is not offered"));
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(async () => settled());
    const confirm = screen.queryByRole("button", { name: "Trotzdem speichern" });
    if (confirm !== null) await user.click(confirm);
    await sent();

    const saved = calls.filter((call) => call.action === "patchAdminSpielDataAction").map((call) => call.payload as Record<string, unknown>);
    assert.equal(saved.length, 1, "the pick was never saved, so nothing below is judged");
    const booked = saved[0]?.["schiedsrichter"] as { schiedsrichter_id?: string } | null;
    assert.deepEqual([booked?.schiedsrichter_id, saved[0]?.["schiedsrichter_stand"]], [REFEREE.id, null]);
  });
});
