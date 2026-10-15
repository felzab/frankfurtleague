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

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";
import type { FLSpielort } from "@/features/spielorte/schemas.ts";

// One answer serves a venue create and a match save alike, so a save the dialog set off would be answered and seen.
const { calls, answered } = doubleActions({
  modules: ["/src/features/spiele/actions.ts", "/src/features/spielorte/actions.ts", "/src/features/schiedsrichter/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", priorPaarungen: [], created_id: "6890a1b2c3d4e5f607800099" }),
});
doubleToasts();

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

const REFEREE: FLSchiedsrichter = {
  id: "6890a1b2c3d4e5f607800031",
  name: "Erika Muster",
  schule: null,
  default_payment: 20,
  kontakt: { telefon: null, email: "erika.muster@example.org" },
  inactive_since: null,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
  adresswechsel: null,
};

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
        today: "2026-09-14",
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );
  await user.type(screen.getByRole("textbox", { name: "Notiz zum Spiel" }), "Halle getauscht");
}

/** The picker's trigger group, whose own click toggles the list: HeroUI wraps the select's button in it. */
function pickerTrigger(label: string): HTMLElement {
  const button = [...document.querySelectorAll<HTMLElement>('button[aria-haspopup="listbox"]')].find((candidate) =>
    (candidate.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .some((id) => document.getElementById(id)?.textContent?.trim().startsWith(label) === true),
  );
  return button?.closest<HTMLElement>('[data-slot="autocomplete-trigger"]') ?? assert.fail(`no picker trigger labelled ${label}`);
}

async function openVenueDialog(user: ReturnType<typeof userEvent.setup>, create: RegExp): Promise<HTMLElement> {
  await user.click(pickerTrigger("Spielort"));
  await user.click(await screen.findByRole("button", { name: create }));
  return screen.findByRole("dialog", { name: "Spielort anlegen" });
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

  /* react-stately opens no select over an empty list, which left a league with no venue no way to its first. */
  it("opens over a league holding no venue and reaches the create dialog", async () => {
    const user = userEvent.setup();
    await renderEditor(user, { spielorte: [] });

    await openVenueDialog(user, /Jetzt anlegen/);
  });
});
