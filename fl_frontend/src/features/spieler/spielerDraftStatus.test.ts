import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSpielerDraftStatus } from "./spielerDraftStatus";

import type { FLSpielerDraftFields } from "./spielerDraftStatus";
import type { SpielerTeamOption } from "./types";

const HELMHOLTZ: SpielerTeamOption = { teamId: "6890a1b2c3d4e5f607190001", name: "Helmholtz", shorthand: "HE" };
const LESSING: SpielerTeamOption = { teamId: "6890a1b2c3d4e5f607190002", name: "Lessing", shorthand: "LE" };
const TEAMS: SpielerTeamOption[] = [HELMHOLTZ, LESSING];

const stored: FLSpielerDraftFields = {
  vorname: "Max",
  nachname: "Mustermann",
  membership: {
    team_id: HELMHOLTZ.teamId,
    nummer: "10",
    position: "Mittelfeld",
    stufe: "Q1",
    is_nachgetragen: false,
    is_captain: false,
  },
};

const draftFrom = (overrides: Partial<FLSpielerDraftFields>): FLSpielerDraftFields => ({ ...stored, ...overrides });

const squad = (overrides: Partial<NonNullable<FLSpielerDraftFields["membership"]>>) => ({
  membership: { ...stored.membership!, ...overrides },
});

describe("deriveSpielerDraftStatus", () => {
  it("reports a clean draft as not dirty, with every field present", () => {
    const status = deriveSpielerDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {}, teams: TEAMS });

    assert.equal(status.isDirty, false);
    assert.equal(status.changed.length, 0);
    // Two person fields plus the five squad rows; `is_nachgetragen` is a note, never a field.
    assert.equal(status.fields.length, 7);
  });

  it("reports a renamed player as one change carrying both texts", () => {
    const status = deriveSpielerDraftStatus({ stored, draft: draftFrom({ vorname: "Moritz" }), fieldErrors: {}, teams: TEAMS });

    assert.equal(status.isDirty, true);
    assert.deepEqual(
      status.changed.map((field) => [field.path, field.storedText, field.draftText]),
      [["vorname", "Max", "Moritz"]],
    );
  });

  it("drops every squad row while the player is in no squad that season", () => {
    const status = deriveSpielerDraftStatus({
      stored: draftFrom({ membership: null }),
      draft: draftFrom({ membership: null }),
      fieldErrors: {},
      teams: TEAMS,
    });

    assert.deepEqual(
      status.fields.map((field) => field.path),
      ["vorname", "nachname"],
    );
  });

  it("reads a transfer as the two teams' NAMES, never their ids", () => {
    const status = deriveSpielerDraftStatus({
      stored,
      draft: draftFrom(squad({ team_id: LESSING.teamId })),
      fieldErrors: {},
      teams: TEAMS,
    });

    const row = status.byPath.get("team_id");
    assert.ok(row?.isChanged);
    assert.equal(row.storedText, "Helmholtz");
    assert.equal(row.draftText, "Lessing");
  });

  it("falls back to the id for a team the selected season does not offer", () => {
    // A real state, not a defect: the player is in a team this season does not offer.
    const status = deriveSpielerDraftStatus({
      stored: draftFrom(squad({ team_id: "6890a1b2c3d4e5f607190009" })),
      draft: draftFrom(squad({ team_id: "6890a1b2c3d4e5f607190009" })),
      fieldErrors: {},
      teams: TEAMS,
    });

    assert.equal(status.byPath.get("team_id")?.storedText, "6890a1b2c3d4e5f607190009");
  });

  it("treats a cleared number as removed rather than changed-to-empty-string", () => {
    const status = deriveSpielerDraftStatus({ stored, draft: draftFrom(squad({ nummer: "" })), fieldErrors: {}, teams: TEAMS });

    const row = status.byPath.get("nummer");
    assert.ok(row?.isChanged);
    // `draftText: null` is what makes the change list render this as a removal.
    assert.equal(row.draftText, null);
    assert.equal(row.storedText, "10");
  });

  it("treats a cleared position as removed, because a squad entry is filled in over time", () => {
    const status = deriveSpielerDraftStatus({ stored, draft: draftFrom(squad({ position: null })), fieldErrors: {}, teams: TEAMS });

    const row = status.byPath.get("position");
    assert.ok(row?.isChanged);
    assert.equal(row.draftText, null);
    assert.equal(row.storedText, "Mittelfeld");
  });

  it("ignores is_nachgetragen entirely, because nothing on the page edits it", () => {
    // It still travels on the payload — the patch replaces the row wholesale — but a draft that
    // differs on it is not a change the save bar counts.
    const status = deriveSpielerDraftStatus({
      stored,
      draft: draftFrom(squad({ is_nachgetragen: true })),
      fieldErrors: {},
      teams: TEAMS,
    });

    assert.equal(status.byPath.get("is_nachgetragen"), undefined);
    assert.equal(status.isDirty, false);
  });

  it("reads a captaincy as a value gained and losing it as a removal", () => {
    const gained = deriveSpielerDraftStatus({ stored, draft: draftFrom(squad({ is_captain: true })), fieldErrors: {}, teams: TEAMS });
    assert.equal(gained.byPath.get("is_captain")?.storedText, null);
    assert.equal(gained.byPath.get("is_captain")?.draftText, "Ja");

    const lost = deriveSpielerDraftStatus({
      stored: draftFrom(squad({ is_captain: true })),
      draft: draftFrom(squad({ is_captain: false })),
      fieldErrors: {},
      teams: TEAMS,
    });
    assert.equal(lost.byPath.get("is_captain")?.draftText, null);
  });

  it("carries a field error onto its own row and into invalid", () => {
    const status = deriveSpielerDraftStatus({
      stored,
      draft: draftFrom({ vorname: "" }),
      fieldErrors: { vorname: "Bitte gib einen Vornamen ein." },
      teams: TEAMS,
    });

    assert.equal(status.byPath.get("vorname")?.error, "Bitte gib einen Vornamen ein.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["vorname"],
    );
  });

  it("counts several changes across both groups", () => {
    const status = deriveSpielerDraftStatus({
      stored,
      draft: { ...draftFrom({ nachname: "Muster" }), ...squad({ stufe: "Q2" }) },
      fieldErrors: {},
      teams: TEAMS,
    });

    assert.equal(status.changed.length, 2);
    assert.deepEqual(
      status.changed.map((field) => field.group),
      ["Person", "Kader"],
    );
  });
});
