import { doubleApiClient } from "@/test-support/apiClientDouble";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { FLSonderereignis } from "@/core/generated/client/types";
import { SERVER_COPY } from "@/core/serverCopy";

import type { FLSpielbestaetigungEditorRow, FLSpieleAdminSingleResponse } from "@/core/generated/client/types";
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

  // The harm: a line-up still missing past the club's lock drawn with the club's grey „Gesperrt“, so the league reads
  // as locked to it a line-up its own page still enters.
  it("draws a line-up missing past the club's lock as overdue", async () => {
    const team2 = { stored: false, phase: "locked" as const, due_at: "2026-11-11T15:00:00Z" };
    const editor = await editorOver({ ...VIEW, aufstellung_marks: { ...VIEW.aufstellung_marks, team2 } });

    expect(editor.props.aufstellungen.map(({ chip }) => chip)).toStrictEqual([
      undefined,
      { tone: "danger", label: COPY.area.team.aufstellung.overdue },
    ]);
  });

  // The harm: a match that owes no line-up any more, called off, struck out, abandoned or not turned up to, drawn with
  // „Überfällig“ beside „Fehlt“, so the league chases a club for a line-up the club's own pages say nobody needs; or
  // drawn with no row, so the league loses the way to the line-up it still enters and the counts it stored.
  it("keeps each side's row on a match carrying any event, saying nothing is owed", async () => {
    for (const sonderereignis of Object.values(FLSonderereignis)) {
      const editor = await editorOver({ ...VIEW, spiel: { ...VIEW.spiel, sonderereignis } });

      const words = COPY.area.team.aufstellung;
      expect(editor.props.aufstellungen, sonderereignis).toStrictEqual([
        {
          id: "team1",
          href: `/admin/saisons/2027/spiele/${SPIEL_ID}/aufstellung/${TEAM1}`,
          name: words.ofTeam({ record: "Ahorn" }),
          line: words.counts(14, 11, 11),
        },
        { id: "team2", href: `/admin/saisons/2027/spiele/${SPIEL_ID}/aufstellung/${TEAM2}`, name: words.ofTeam({ record: "Eiche" }) },
      ]);
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
  const ansetzung = { date: "2026-11-14", time: "16:00:00", spielort_id: null, team1_id: TEAM1, team2_id: TEAM2, digest: "d" };
  /** The first club's row reading as `state`, unanswered and open unless `fields` say otherwise. */
  const row = (
    state: FLSpielbestaetigungEditorRow["state"],
    fields: Partial<FLSpielbestaetigungEditorRow> = {},
  ): FLSpielbestaetigungEditorRow => ({
    id: "64b0000000000000000000a1",
    saison_id: "2027",
    spiel_id: SPIEL_ID,
    party: { kind: "team", team_id: TEAM1 },
    ansetzung,
    deadline: "2026-11-10",
    due_by: "2026-11-10",
    lapsed_on: null,
    asked_at: "2026-11-03",
    reminded_at: null,
    answer: null,
    closed: null,
    state,
    ...fields,
  });
  const agreement = {
    kind: "agreed" as const,
    at: "2026-11-05",
    by: { kind: "kontakt" as const, rolle: "trainer" as const },
    vorschlag: null,
    reason: null,
  };
  const notAsked = { chip: { tone: "warn", label: COPY.template.open }, line: COPY.admin.spiel.notAsked };
  const lapsed = { tone: "neutral", label: COPY.admin.expired };
  const missing = SERVER_COPY.overview.missing(COPY.area.answer);
  const agreed = { tone: "success", label: COPY.admin.spiel.agreed };

  // The harm: an answer drawn in a state its party's row is not in: open where the backend lets the party answer
  // nothing more, lapsed or not asked where the party answered, so the league chases or trusts the wrong club.
  it.each([
    {
      reads: "lapsed",
      rows: [row("expired", { lapsed_on: "2026-11-10" })],
      // The day it lapsed on, as every other page under that chip says, not a day still to come.
      shown: { chip: lapsed, line: COPY.admin.schiedsrichter.expiredOn("2026-11-10") },
    },
    // An exit or a decision ended it before its deadline, which it never lapsed on.
    { reads: "ended on no day", rows: [row("expired")], shown: { chip: lapsed, line: missing } },
    {
      reads: "in time",
      rows: [row("valid")],
      shown: { chip: { tone: "warn", label: missing }, line: COPY.admin.spiel.answerBy("2026-11-10") },
    },
    {
      reads: "agreed, its row closed at the kick-off",
      rows: [row("agreed", { answer: agreement, closed: { reason: "spiel_past" } })],
      shown: { chip: agreed, line: { record: "05.11.2026" } },
    },
    {
      // The fixture counts a decline whose proposal the league discarded as the club's agreement to the date it kept.
      reads: "agreed by its discarded proposal",
      rows: [
        row("agreed", {
          answer: { ...agreement, kind: "declined", vorschlag: { date: "2026-11-21", time: "16:00:00" } },
          closed: { reason: "discarded" },
        }),
      ],
      shown: { chip: agreed, line: COPY.admin.actionLog.action["spielbestaetigung.vorschlag_discarded"] },
    },
    {
      // Newer than the agreement under it, which was about the slot the match has left.
      reads: "about a slot the match has left",
      rows: [row("invalid"), row("agreed", { id: "64b0000000000000000000a0", answer: agreement })],
      shown: notAsked,
    },
    {
      // Moved since it agreed: the answer is about its old slot alone, which „not asked“ would hide.
      reads: "answered about a slot the match has left",
      rows: [row("invalid", { ansetzung: { ...ansetzung, date: "2026-11-07", time: "15:00:00" }, answer: agreement })],
      shown: { chip: agreed, line: SERVER_COPY.season.labelled(COPY.admin.facts.before, COPY.spielplan.when("2026-11-07", "15:00:00")) },
    },
    { reads: "about a call-off since undone", rows: [row("cancelled", { closed: { reason: "cancelled" } })], shown: notAsked },
    // Minted while the club held no confirmed seat, so no mail asked it: chased for an answer, it has no link to give one.
    { reads: "in time that nobody could be mailed on", rows: [row("valid", { asked_at: null })], shown: notAsked },
  ])("draws the first club's newest row $reads by the state it reads as", async ({ rows, shown }) => {
    const editor = await editorOver({ ...VIEW, spielbestaetigungen: rows });

    const [first] = editor.props.answers;
    expect({ chip: first?.chip, line: first?.line }).toStrictEqual(shown);
  });

  // The harm: a referee, whom the clubs' deadline does not bind, drawn as due or lapsed on it, so the league chases
  // them days early.
  it.each([
    { reads: "in time", fields: { state: "valid" as const }, line: COPY.admin.spiel.answerBy("2026-11-14") },
    {
      reads: "lapsed",
      fields: { state: "expired" as const, lapsed_on: "2026-11-14" },
      line: COPY.admin.schiedsrichter.expiredOn("2026-11-14"),
    },
  ])("dates the referee's answer $reads by the slot's day", async ({ fields, line }) => {
    const referee = "64b000000000000000000005";
    const editor = await editorOver({
      ...VIEW,
      spiel: { ...VIEW.spiel, schiedsrichter: { schiedsrichter_id: referee, name: "Kiefer", payment: 25 } },
      spielbestaetigungen: [row("valid", { party: { kind: "schiedsrichter", schiedsrichter_id: referee }, due_by: "2026-11-14", ...fields })],
    });

    expect(editor.props.answers.find(({ id }) => id === "schiedsrichter")?.line).toStrictEqual(line);
  });

  // The harm: a party drawn as owing an answer on a match an event ended, which takes none; or an answer a party gave
  // dropped with it, so the league loses what a club said of the match.
  it("keeps only the answers given on a match carrying any event", async () => {
    const referee = "64b000000000000000000005";
    const rows = [
      row("expired"),
      row("declined", { party: { kind: "team", team_id: TEAM2 }, answer: { ...agreement, kind: "declined" } }),
      row("agreed", { party: { kind: "schiedsrichter", schiedsrichter_id: referee }, answer: agreement }),
    ];
    for (const sonderereignis of Object.values(FLSonderereignis)) {
      const editor = await editorOver({
        ...VIEW,
        spiel: { ...VIEW.spiel, sonderereignis, schiedsrichter: { schiedsrichter_id: referee, name: "Kiefer", payment: 25 } },
        spielbestaetigungen: rows,
      });

      expect(
        editor.props.answers.map(({ id }) => id),
        sonderereignis,
      ).toStrictEqual(["team2", "schiedsrichter"]);
    }
  });
});
