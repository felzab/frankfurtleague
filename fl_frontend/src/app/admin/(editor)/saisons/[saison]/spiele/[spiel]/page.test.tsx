import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { FLSonderereignis } from "@/core/generated/client/types";
import { SERVER_COPY } from "@/core/serverCopy";

import type { FLSpieleAdminSingleResponse } from "@/core/generated/client/types";
import type { ReactElement } from "react";
import type { SpielEditor } from "./SpielEditor";

const SPIEL_ID = "64b000000000000000000001";
const TEAM1 = "64b000000000000000000003";
const TEAM2 = "64b000000000000000000004";

/** A dated group match whose first side's club has stored a line-up and whose second side's has not. */
const VIEW: FLSpieleAdminSingleResponse = {
  spiel: {
    id: SPIEL_ID,
    spieltag_id: "64b000000000000000000002",
    team1: { team_id: TEAM1, name: "Ahorn", shorthand: "AHO", tore: null, austritt_type: null },
    team2: { team_id: TEAM2, name: "Eiche", shorthand: "EIC", tore: null, austritt_type: null },
    team1_quelle: null,
    team2_quelle: null,
    date: "2026-11-14",
    time: "16:00:00",
    spielort: null,
    schiedsrichter: null,
    ergebnis: null,
    elfmeterschiessen: null,
    spiel_nr: 3,
    sonderereignis: null,
    saison_phase: "gruppenphase",
    saison_id: "2027",
    note: null,
    ansetzung_confirmed: null,
    for_third_place: false,
    version: 3,
  },
  aufstellungen: { team1: { count: 14, starters: 11 }, team2: null },
  aufstellung_marks: {
    team1: { stored: true, phase: "overdue", due_at: "2026-11-11T15:00:00Z" },
    team2: { stored: false, phase: "overdue", due_at: "2026-11-11T15:00:00Z" },
  },
  saison_status: "active",
  saison_begun: true,
  schiedsrichter: [],
  spielbericht: null,
  spielbestaetigungen: [],
  spielorte: [],
  teams: null,
};

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

let served = VIEW;

doubleApiClient(() => served);

const { default: SpielEditorPage } = await import("./page");

/** The editor the page draws over `view`. */
async function editorOver(view: FLSpieleAdminSingleResponse) {
  served = view;
  const shell = SpielEditorPage({
    params: Promise.resolve({ saison: "2027", spiel: SPIEL_ID }),
    searchParams: Promise.resolve({}),
  }) as ReactElement<{ editor: Promise<ReactElement<Parameters<typeof SpielEditor>[0]>> }>;
  return await shell.props.editor;
}

describe("the match editor's links to the line-ups", () => {
  // The harm: one club's line-up counted under the other's name, or a row leading to the other club's line-up, so the
  // league reads a missing line-up as entered and enters it for the wrong club.
  it("states and links each side's own club's line-up", async () => {
    const editor = await editorOver(VIEW);

    const words = COPY.area.team.aufstellung;
    expect(editor.props.aufstellungen).toStrictEqual([
      {
        id: "team1",
        href: `/admin/saisons/2027/spiele/${SPIEL_ID}/aufstellung/${TEAM1}`,
        name: words.ofTeam({ record: "Ahorn" }),
        line: words.counts(14, 11, 11),
      },
      {
        id: "team2",
        href: `/admin/saisons/2027/spiele/${SPIEL_ID}/aufstellung/${TEAM2}`,
        name: words.ofTeam({ record: "Eiche" }),
        // The chip the club's own pages draw past the due mark, on the side with none stored alone.
        chip: { tone: "danger", label: words.overdue },
        line: words.missing,
      },
    ]);
  });

  // The harm: a match that owes no line-up any more, called off, struck out, abandoned or not turned up to, drawn with
  // „Überfällig“ beside „Fehlt“, so the league chases a club for a line-up the club's own pages say nobody needs.
  it("draws no row for a match carrying any event", async () => {
    for (const sonderereignis of Object.values(FLSonderereignis)) {
      const editor = await editorOver({ ...VIEW, spiel: { ...VIEW.spiel, sonderereignis } });

      expect(editor.props.aufstellungen, sonderereignis).toStrictEqual([]);
    }
  });
});

describe("the match editor before its season's start", () => {
  // The harm: an event the write refuses before the start offered as a choice, so the save fails only once it is made.
  it("closes the events that record the match and leaves a call-off and a strike-out open", async () => {
    const editor = await editorOver({ ...VIEW, saison_begun: false });

    expect(editor.props.begun).toBe(false);
    expect(editor.props.sonderereignisse.filter(({ isDisabled }) => isDisabled === true).map(({ id }) => id)).toStrictEqual([
      "nichtantreten_team1",
      "nichtantreten_team2",
      "abgebrochen",
    ]);
  });
});

describe("the match editor's answers", () => {
  // The harm: a booking an erasure left naming nobody drawn as a party not yet asked, whom nobody can ask.
  it("draws no referee's row for a booking naming nobody", async () => {
    const editor = await editorOver({
      ...VIEW,
      spiel: { ...VIEW.spiel, schiedsrichter: { schiedsrichter_id: null, name: null, payment: 25 } },
    });

    expect(editor.props.answers.map(({ id }) => id)).toStrictEqual(["team1", "team2"]);
  });

  // The harm: a lapsed answer drawn as one still open, so the league waits on a club the backend no longer lets answer.
  it("says „Abgelaufen“ in grey where the read says the answer lapsed, and „Antwort fehlt“ where it is still in time", async () => {
    const row = (team_id: string, expired: boolean) => ({
      id: `64b0000000000000000000${team_id === TEAM1 ? "a1" : "a2"}`,
      saison_id: "2027",
      spiel_id: SPIEL_ID,
      party: { kind: "team" as const, team_id },
      ansetzung: { date: "2026-11-14", time: "16:00:00", spielort_id: null, team1_id: TEAM1, team2_id: TEAM2, digest: "d" },
      deadline: "2026-11-10",
      asked_at: "2026-11-03",
      reminded_at: null,
      answer: null,
      closed: null,
      expired,
    });
    const editor = await editorOver({ ...VIEW, spielbestaetigungen: [row(TEAM1, true), row(TEAM2, false)] });

    expect(editor.props.answers.map(({ chip }) => chip)).toStrictEqual([
      { tone: "neutral", label: COPY.admin.expired },
      { tone: "warn", label: SERVER_COPY.overview.missing(COPY.area.answer) },
    ]);
  });
});
