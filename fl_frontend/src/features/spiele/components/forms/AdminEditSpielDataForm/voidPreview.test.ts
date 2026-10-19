import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { APINetworkError } from "@/core/errors.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";
import type { FLSpielort } from "@/features/spielorte/schemas.ts";
import type { FLTeam } from "@/features/teams/schemas.ts";
import type { UserEvent } from "@testing-library/user-event";
import type { TestContext } from "node:test";

/* The dry run's transport timed out, answered as `runAdminMutation` answers the preview's read-only
   declaration: the transport marks the PATCH read-only, so nothing may read it as a write that stands. */
const STALLED_PREVIEW = toActionErrorResult(
  new APINetworkError({
    message: "timed out",
    url: "http://localhost/api/v0/spiele/6890a1b2c3d4e5f607182901?dry_run=true",
    method: "PATCH",
    readOnly: true,
    traceId: "0",
    isTimeout: true,
  }),
  { method: "POST", readOnly: true },
);

const { calls, answerWith } = doubleActions({ modules: ["/src/features/spiele/actions.ts"], answer: () => Promise.resolve(STALLED_PREVIEW) });

const { raised } = doubleToasts();

const { AdminEditSpielDataForm } = await import("./AdminEditSpielDataForm.tsx");

const SPIELTAG_ID = "6890a1b2c3d4e5f607182990";

const side = (team_id: string, name: string, shorthand: string) => ({ team_id, tore: null, name, shorthand, austritt_type: null });

const spiel = (id: string, spiel_nr: number, team1: ReturnType<typeof side>, team2: ReturnType<typeof side>): FLSpielAdmin => ({
  id,
  spieltag_id: SPIELTAG_ID,
  team1,
  team2,
  team1_quelle: null,
  team2_quelle: null,
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2026",
  notiz: null,
  ansetzung_bestaetigt: null,
});

const EDITED = spiel(
  "6890a1b2c3d4e5f607182901",
  1,
  side("68c1f0a2b3c4d5e6f7a8b9c1", "SG Alpha", "SA"),
  side("68c1f0a2b3c4d5e6f7a8b9c2", "SG Beta", "SB"),
);

// A second fixture of the same Spieltag fields two teams, which is what makes the editor ask the dry run at all.
const NEIGHBOUR = spiel(
  "6890a1b2c3d4e5f607182902",
  2,
  side("68c1f0a2b3c4d5e6f7a8b9c3", "SG Gamma", "SG"),
  side("68c1f0a2b3c4d5e6f7a8b9c4", "SG Delta", "SD"),
);

/** The editor over EDITED, whose Spieltag neighbour is what makes it ask the dry run, with every queued timer run. */
async function renderAndPreview(t: TestContext): Promise<void> {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  render(
    underNext(
      h(AdminEditSpielDataForm, {
        spielData: EDITED,
        teams: [],
        spielorte: [],
        schiedsrichter: [],
        saisonSpiele: [EDITED, NEIGHBOUR],
        numberOfGroups: 2,
        isFinishedSaison: false,
        isActiveSaison: true,
        today: "2026-09-14",
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );

  // Every timer the render queued, the preview's debounce among them, then the answer it asked for.
  await act(async () => t.mock.timers.runAll());
  assert.deepEqual(
    calls.map((call) => call.action),
    ["previewAdminSpielDataAction"],
    "the editor never asked the dry run, so nothing below is judged",
  );
}

const UNGEPRUEFT = "Ob Spiele dadurch entfallen, konnte nicht geprüft werden";

describe("the match editor's preview when its dry run is not answered", () => {
  beforeEach(() => {
    calls.length = 0;
    raised.length = 0;
  });

  /* An empty rail reads as a save that voids nothing, which an unanswered preview never said, so it
     says it could not check; and it names no fixture and no write that may have landed. */
  for (const [how, answer] of [
    ["times out", () => Promise.resolve(STALLED_PREVIEW)],
    // A cut request rejects the action, and from the debounce's timer nothing else answers that.
    ["is cut", () => Promise.reject(new Error("An unexpected response was received from the server."))],
  ] as const) {
    it(`says it could not check, and names no fixture, when the dry run ${how}`, async (t) => {
      answerWith(answer);
      await renderAndPreview(t);

      assert.ok(screen.queryAllByText(UNGEPRUEFT).length > 0, "the unanswered preview left the rail silent");
      assert.deepEqual(raised, [], "the unanswered preview raised a toast");
      assert.equal(
        screen.queryAllByText(/Speichern löscht|entfernt|kein Spiel|keine Spiele/).length,
        0,
        "an unanswered preview names a fixture, or none",
      );
      assert.equal(screen.queryAllByText(/ist unklar/).length, 0, "a read that stored nothing is worded as a write that may stand");
    });
  }

  /* The line is the failure's alone: a preview that answered with nothing voided has checked. */
  it("says nothing about checking when the dry run answered that nothing is voided", async (t) => {
    answerWith(() => Promise.resolve({ success: true, voidedFixtures: [], releasedFixtures: [] }));
    await renderAndPreview(t);

    assert.equal(screen.queryAllByText(UNGEPRUEFT).length, 0, "a preview that answered is worded as one that could not check");
  });
});

/** The day every editor below is rendered on, and a fixture's day so many days after it. */
const HEUTE = "2026-09-14";
const tagNach = (tage: number): string => new Date(Date.parse(HEUTE) + tage * 86_400_000).toISOString().slice(0, 10);

const SOFORT = /müssen die Teams noch am Tag der Anfrage bestätigen/;

/** EDITED, dated, with a kick-off and a ground: a fixture the confirmations' sweep asks about. */
const angesetzt = (datum: string): FLSpielAdmin => ({
  ...EDITED,
  datum: datum,
  uhrzeit: "14:30:00",
  ort: { spielort_id: "68c1f0a2b3c4d5e6f7a8b9d1", name: "Sportpark Rebstock", maps_link: "Sportpark Rebstock, Frankfurt", mietpreis: 0 },
});

const ADRESSE = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };

/** A second ground the picker offers beside the stored one. */
const ANDERER_ORT: FLSpielort = {
  id: "68c1f0a2b3c4d5e6f7a8b9d2",
  name: "Sporthalle Süd",
  address: ADRESSE,
  maps_link: "Sporthalle Süd, Frankfurt",
  default_mietpreis: 0,
  inactive_since: null,
};

/** A club of the season, as the editor's team list reads it. */
const verein = (id: string, name: string, shorthand: string): FLTeam => ({
  id: id,
  name: name,
  gruppe: "A",
  statistik: {
    anzahl_gespielte_spiele: 0,
    siege: 0,
    niederlagen: 0,
    unentschieden: 0,
    tore_geschossen: 0,
    tore_kassiert: 0,
    punkte: 0,
    anzahl_abgesagte_spiele: 0,
  },
  austritt: null,
  shorthand: shorthand,
  description: "",
  full_name: name,
  website_url: null,
  address: ADRESSE,
  schulform: null,
  inactive_since: null,
});

/** Both stored sides, and a third club the second side's picker can take instead. */
const VEREINE: FLTeam[] = [
  verein("68c1f0a2b3c4d5e6f7a8b9c1", "SG Alpha", "SA"),
  verein("68c1f0a2b3c4d5e6f7a8b9c2", "SG Beta", "SB"),
  verein("68c1f0a2b3c4d5e6f7a8b9c5", "SG Epsilon", "SE"),
];

/** The editor over one fixture of a running season, with no Spieltag neighbour to ask the dry run about. */
function renderEditor(spielData: FLSpielAdmin, teams: FLTeam[] = VEREINE): void {
  render(
    underNext(
      h(AdminEditSpielDataForm, {
        spielData: spielData,
        teams: teams,
        spielorte: [ANDERER_ORT],
        schiedsrichter: [],
        saisonSpiele: [spielData],
        numberOfGroups: 2,
        isFinishedSaison: false,
        isActiveSaison: true,
        today: HEUTE,
        categorize: () => new Set<never>(),
        pageHeader: { title: "Spiel 1" },
      }),
      { search: "saison_id=2026" },
    ),
  );
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

/* The form's half of the banner: which date is the draft's and which the stored one is decided here alone. */
describe("the match editor's warning that a near date leaves the teams no notice", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  /* A save leaving the Ansetzung alone asks nobody, so a near fixture opened to add a referee warns of nothing. */
  it("raises nothing on opening a fixture stored inside the deadline's days", () => {
    renderEditor(angesetzt(tagNach(3)));

    assert.equal(screen.queryAllByText(SOFORT).length, 0, "an unchanged near fixture warns of a request no save causes");
  });

  /* Read the stored date as the draft's, or the draft's twice, and this re-dating raises nothing and saves unasked. */
  it("raises it once a date is moved into the deadline's days, and asks before saving", async () => {
    const user = userEvent.setup();
    renderEditor(angesetzt(tagNach(8)));

    // One day back puts the fixture on the deadline's last day.
    const tag = screen.getAllByRole("spinbutton", { name: /^Tag/ }).at(-1) ?? assert.fail("the editor renders no day to step");
    await act(async () => tag.focus());
    await user.keyboard("{ArrowDown}");

    assert.ok(screen.queryAllByText(SOFORT).length > 0, "a date moved into the window raised nothing");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    assert.ok(screen.queryByRole("button", { name: "Trotzdem speichern" }) !== null, "the save went unasked");
    assert.deepEqual(calls, [], "the save was sent before it was confirmed");
  });

  /* The date stays inside the window, so only the stored ground, side or kick-off tells this save from one that
     leaves the Ansetzung alone: any of them read off the draft, and the move raises nothing. */
  for (const [was, verlegen] of [
    [
      "the ground",
      async (user: UserEvent) => {
        await user.click(pickerTrigger("Spielort"));
        await user.click(screen.getByRole("option", { name: ANDERER_ORT.name }));
      },
    ],
    ...(["Team 1", "Team 2"] as const).map(
      (seite) =>
        [
          `${seite}'s club`,
          async (user: UserEvent) => {
            await user.click(pickerTrigger(seite));
            await user.click(screen.getByRole("option", { name: "SG Epsilon" }));
          },
        ] as const,
    ),
    [
      "the kick-off",
      async (user: UserEvent) => {
        const stunde = screen.getAllByRole("spinbutton", { name: /^Stunde/ }).at(-1) ?? assert.fail("the editor renders no hour to step");
        await act(async () => stunde.focus());
        await user.keyboard("{ArrowUp}");
      },
    ],
  ] as const) {
    it(`raises it once ${was} moves on a fixture stored inside the deadline's days`, async () => {
      const user = userEvent.setup();
      renderEditor(angesetzt(tagNach(3)));
      assert.equal(screen.queryAllByText(SOFORT).length, 0, "the warning stood before anything moved");

      await verlegen(user);

      assert.ok(screen.queryAllByText(SOFORT).length > 0, `moving ${was} inside the window raised nothing`);
    });
  }

  /* The pass asks nothing about a fixture a club has left by its day, and only the season's team list says so. */
  it("raises nothing once the ground moves on a fixture whose second club left before its day", async () => {
    const user = userEvent.setup();
    const austritt = { type: "rueckzug" as const, grund: "Kein Team mehr", datum: tagNach(1) };
    renderEditor(
      angesetzt(tagNach(3)),
      VEREINE.map((verein) => (verein.name === "SG Beta" ? { ...verein, austritt: austritt } : verein)),
    );

    await user.click(pickerTrigger("Spielort"));
    await user.click(screen.getByRole("option", { name: ANDERER_ORT.name }));

    assert.equal(screen.queryAllByText(SOFORT).length, 0, "a fixture the pass never asks about warned of a request");
  });
});
