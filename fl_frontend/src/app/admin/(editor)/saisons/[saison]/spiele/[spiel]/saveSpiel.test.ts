import { doubleApiClient } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

import { NO_SONDEREREIGNIS } from "./spielValues";

import type { Code, FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLSpielJoinedAdmin } from "@/core/generated/client/types";

const SPIEL_ID = "64b000000000000000000001";
const PICKED = "64b00000000000000000000a";

/** A knockout fixture with every field set, so a save dropping one it does not change is seen. */
const STORED: FLSpielJoinedAdmin = {
  id: SPIEL_ID,
  spieltag_id: "64b000000000000000000002",
  team1: { team_id: "64b000000000000000000003", name: "Woehlerschule", shorthand: "WO", tore: 2, austritt_type: null },
  team2: { team_id: "64b000000000000000000004", name: "Ernst-Reuter-Schule", shorthand: "ER", tore: 2, austritt_type: null },
  team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" },
  team2_quelle: { type: "spiel", spiel_nr: 26, ausgang: "sieger" },
  datum: "2027-03-14",
  uhrzeit: "15:30:00",
  ort: { spielort_id: "64b000000000000000000005", name: "Sportpark Nord", maps_link: "Sportpark Nord, Frankfurt", mietpreis: 60 },
  schiedsrichter: { schiedsrichter_id: "64b000000000000000000006", name: "Lena Brandt", payment: 25 },
  ergebnis: "2:2",
  elfmeterschiessen: { team1: 4, team2: 3 },
  spiel_nr: 29,
  sonderereignis: null,
  saison_phase: "halbfinale",
  saison_id: "2027",
  notiz: "Flutlicht",
  ansetzung_confirmed: null,
  for_third_place: false,
  version: 3,
};

/** The fixture as the write is sent it where the editor changed nothing it shows. */
const SENT_AS_STORED = {
  datum: "2027-03-14",
  uhrzeit: "15:30:00",
  ort: { spielort_id: "64b000000000000000000005", mietpreis: 60 },
  schiedsrichter: { schiedsrichter_id: "64b000000000000000000006", payment: 25 },
  team1: { team_id: "64b000000000000000000003", tore: 2 },
  team2: { team_id: "64b000000000000000000004", tore: 2 },
  team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" },
  team2_quelle: { type: "spiel", spiel_nr: 26, ausgang: "sieger" },
  elfmeterschiessen: { team1: 4, team2: 3 },
  sonderereignis: null,
  notiz: "Flutlicht",
  version: 3,
} satisfies FLPatchSpielDataPayload;

/** The write's answer where it moved no other fixture: the fixture's version after the save. */
const NOTHING_MOVED: FLPatchSpielDataResponse = {
  advanced_to: [],
  released_sides: [],
  bracket_faults: [],
  version: 4,
  bericht_adopted: null,
};

const VOIDED_NONE = { voided_ergebnis: null, voided_elfmeterschiessen: null, voided_sonderereignis: null };

/** The fixture the save reads before its write, every payload it sends, and what the write answers. */
const state = vi.hoisted(() => ({
  read: null as unknown,
  sent: [] as unknown[],
  refusal: null as unknown,
  answer: null as unknown,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action, and the write the real dispatch counts reaches it; whether a
// save clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => (state.read === null ? null : { spiel: state.read }),
}));

// The backend client itself is replaced, so the write runs through the real generated call and the real dispatch,
// which counts it and takes it back where the backend refuses it.
const calls = doubleApiClient((call) => {
  state.sent.push(JSON.parse(call.body ?? "null"));
  if (state.refusal !== null) throw state.refusal;
  return state.answer;
});

const { previewSpiel, saveSpiel } = await import("./saveSpiel");

/** The write's 409, naming the body field it judged where it is about one. */
const refusal = (serverErrorCode: Code, about?: readonly string[]) =>
  new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0/spiele/${SPIEL_ID}`,
    statusCode: 409,
    serverErrorCode,
    refusedFields: about === undefined ? [] : [bodyField(about, serverErrorCode)],
    endpoint: `/spiele/${SPIEL_ID}`,
    method: "PATCH",
    readOnly: false,
    traceId: "0",
  });

beforeEach(() => {
  calls.length = 0;
  state.read = STORED;
  state.sent = [];
  state.refusal = null;
  state.answer = NOTHING_MOVED;
});

/** A save of these changes on the version the editor was read at, carrying over no report. */
const saving = (changes: Parameters<typeof saveSpiel>[0] extends infer Sent ? (Sent extends { changes: infer C } ? C : never) : never) => ({
  id: SPIEL_ID,
  version: STORED.version,
  adoptsBericht: null,
  changes,
});

describe("the match editor's save", () => {
  it("sends the changes over every field the editor leaves, as stored, on the version it read, answering the new one", async () => {
    const answer = await saveSpiel(saving({ uhrzeit: "18:00:00" }));

    expect(answer).toEqual({ ok: true, value: 4 });
    // The write itself, never its dry run, and no report stamped.
    expect(calls.map(({ endpoint, method }) => ({ endpoint, method }))).toStrictEqual([{ endpoint: `/spiele/${SPIEL_ID}`, method: "PATCH" }]);
    expect(state.sent).toEqual([{ ...SENT_AS_STORED, uhrzeit: "18:00:00" }]);
  });

  it("stands a hand-picked club on its side without the side's source, which the bracket would otherwise put back", async () => {
    await saveSpiel(saving({ team2: PICKED }));

    expect(state.sent).toMatchObject([
      { team1: SENT_AS_STORED.team1, team1_quelle: SENT_AS_STORED.team1_quelle, team2: { team_id: PICKED, tore: 2 }, team2_quelle: null },
    ]);
  });

  it("stamps the report the result was carried over from", async () => {
    await saveSpiel({ ...saving({ tore1: "3", tore2: "1" }), adoptsBericht: 2 });

    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([`/spiele/${SPIEL_ID}?adopts_bericht=2`]);
    // Goals no longer level: the shoot-out goes, as the write drops it.
    expect(state.sent).toMatchObject([{ team1: { tore: 3 }, team2: { tore: 1 }, elfmeterschiessen: null }]);
  });

  it("says which other fixture the write moved", async () => {
    state.answer = {
      ...NOTHING_MOVED,
      advanced_to: [{ spiel_id: "64b000000000000000000007", spiel_nr: 31, ...VOIDED_NONE, voided_ergebnis: "1:0" }],
    } satisfies FLPatchSpielDataResponse;

    const answer = await saveSpiel(saving({ sonderereignis: "nichtantreten_team1" }));

    expect(answer).toEqual({ ok: true, value: 4, note: COPY.admin.spiel.alsoChanged([31]) });
  });

  it("names each other fixture once, a released side's among them, in its number's order", async () => {
    state.answer = {
      ...NOTHING_MOVED,
      advanced_to: [
        { spiel_id: "64b000000000000000000007", spiel_nr: 31, ...VOIDED_NONE },
        { spiel_id: "64b000000000000000000008", spiel_nr: 12, ...VOIDED_NONE },
      ],
      // One fixture both moved and released a side, and one only released it.
      released_sides: [
        { spiel_id: "64b000000000000000000008", spiel_nr: 12, side: "team2", team_name: "Weide", ...VOIDED_NONE },
        { spiel_id: "64b000000000000000000009", spiel_nr: 7, side: "team1", team_name: "Linde", ...VOIDED_NONE },
      ],
    } satisfies FLPatchSpielDataResponse;

    const answer = await saveSpiel(saving({ uhrzeit: "18:00:00" }));

    expect(answer).toEqual({ ok: true, value: 4, note: COPY.admin.spiel.alsoChanged([7, 12, 31]) });
  });

  it("answers as stale a fixture gone since the editor read it, writing nothing", async () => {
    state.read = null;

    const answer = await saveSpiel(saving({ uhrzeit: "18:00:00" }));

    expect(answer).toEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(state.sent).toEqual([]);
  });

  it("sends no goals and no shoot-out with an event that leaves the match without a typed result", async () => {
    for (const sonderereignis of ["nichtantreten_team2", "ausgefallen"]) {
      await saveSpiel(saving({ sonderereignis }));
    }

    expect(state.sent).toMatchObject([
      // A no-show's goals are the award the write composes.
      { sonderereignis: "nichtantreten_team2", team1: { tore: null }, team2: { tore: null }, elfmeterschiessen: null },
      { sonderereignis: "ausgefallen", team1: { tore: null }, team2: { tore: null }, elfmeterschiessen: null },
    ]);
  });

  it("never turns a no-show's awarded goals into a played result once the no-show is taken back", async () => {
    state.read = {
      ...STORED,
      team1: { team_id: "64b000000000000000000003", name: "Woehlerschule", shorthand: "WO", tore: 3, austritt_type: null },
      team2: { team_id: "64b000000000000000000004", name: "Ernst-Reuter-Schule", shorthand: "ER", tore: 0, austritt_type: null },
      ergebnis: "3:0",
      elfmeterschiessen: null,
      sonderereignis: "nichtantreten_team2",
    } satisfies FLSpielJoinedAdmin;

    await saveSpiel(saving({ sonderereignis: NO_SONDEREREIGNIS }));

    expect(state.sent).toMatchObject([{ sonderereignis: null, team1: { tore: null }, team2: { tore: null } }]);
  });

  it("books no venue and no price where the venue is cleared", async () => {
    await saveSpiel(saving({ spielort: null, mietpreis: "" }));

    expect(state.sent).toMatchObject([{ ort: null }]);
  });

  it("keeps back a price that is not a figure on its field, writing nothing", async () => {
    const answer = await saveSpiel(saving({ mietpreis: "60 Euro" }));

    expect(answer).toEqual({ ok: false, fieldErrors: { "changes.mietpreis": COPY.shared.field.format(COPY.admin.spielort.mietpreisExample) } });
    expect(state.sent).toEqual([]);
  });

  it("asks for each booking's money and each side's goals the save needs, writing nothing", async () => {
    const answer = await saveSpiel(saving({ mietpreis: "", honorar: "", tore2: "" }));

    const required = COPY.shared.field.required;
    expect(answer).toEqual({
      ok: false,
      fieldErrors: { "changes.mietpreis": required, "changes.honorar": required, "changes.tore2": required },
    });
    expect(state.sent).toEqual([]);
  });

  it("places the write's refusal on the field that caused it, in the status line, or on the stale-page line", async () => {
    const save = saving({ datum: "2027-05-01" });

    // A field pattern's phrase, by the path the write names, onto the editor's box for it.
    state.refusal = refusal("state_ergebnis_on_a_non_event", ["sonderereignis"]);
    expect(await saveSpiel(save)).toEqual({
      ok: false,
      errorCode: "state_ergebnis_on_a_non_event",
      fieldErrors: { "changes.sonderereignis": SERVER_COPY.refusal.state_ergebnis_on_a_non_event },
    });

    // A refusal no pattern words is its sentence on the bar, naming the field the write names.
    const { refusalLine } = SERVER_COPY;
    const onBar = [
      ["spiel_outside_spieltag", ["datum"], refusalLine.spiel_outside_spieltag],
      ["state_nichtantreten_without_two_sides", ["sonderereignis"], refusalLine.state_nichtantreten_without_two_sides],
      ["booking_unknown_resource", ["ort", "spielort_id"], refusalLine.booking_unknown_resource.ort],
      ["booking_unknown_resource", ["schiedsrichter", "schiedsrichter_id"], refusalLine.booking_unknown_resource.schiedsrichter],
      ["booking_unconfirmed_schiedsrichter", ["schiedsrichter", "schiedsrichter_id"], refusalLine.booking_unconfirmed_schiedsrichter],
      ["spiel_double_booked", ["ort", "spielort_id"], refusalLine.spiel_double_booked.ort],
      ["spiel_double_booked", ["schiedsrichter", "schiedsrichter_id"], refusalLine.spiel_double_booked.schiedsrichter],
      ["eligibility_disqualified", ["team1", "team_id"], refusalLine.eligibility_disqualified.team1],
      ["eligibility_disqualified", ["team2", "team_id"], refusalLine.eligibility_disqualified.team2],
    ] as const;
    for (const [code, about, reason] of onBar) {
      state.refusal = refusal(code, about);
      expect(await saveSpiel(save), `${code} ${about.join(".")}`).toEqual({ ok: false, errorCode: code, reason });
    }

    // A finished season refuses the write whole, so its line stands alone on the bar.
    state.refusal = refusal("saison_past");
    expect(await saveSpiel(save)).toEqual({ ok: false, errorCode: "saison_past", reason: SERVER_COPY.refusalLine.saison_past });

    // The bracket fielding a club twice names no field, and a reload would answer the same: its sentence, never the stale line.
    state.refusal = refusal("spieltag_occupied_by_the_resolution");
    expect(await saveSpiel(save)).toEqual({
      ok: false,
      errorCode: "spieltag_occupied_by_the_resolution",
      reason: SERVER_COPY.refusalLine.spieltag_occupied_by_the_resolution,
    });

    // The editor offers only the clubs the write takes, so a team's refusal means the fixture changed under it.
    for (const code of ["ergebnis_side_emptied", "spieltag_occupied", "eligibility_team_not_in_saison"] as const) {
      state.refusal = refusal(code);
      expect(await saveSpiel(save), code).toEqual({ ok: false, errorCode: code, reason: COPY.shared.failure.stale });
    }

    // The fixture changed since the editor read it: the write refused the version it was sent.
    state.refusal = refusal("version_stale");
    expect(await saveSpiel(save)).toEqual({ ok: false, errorCode: "version_stale", reason: COPY.shared.failure.stale });
  });
});

describe("the match editor's dry run", () => {
  it("asks the write's own dry run, answering only the later matches whose results it would delete", async () => {
    state.answer = {
      ...NOTHING_MOVED,
      advanced_to: [
        { spiel_id: "64b000000000000000000007", spiel_nr: 33, ...VOIDED_NONE, voided_ergebnis: "1:0" },
        // An occupant moved into a match not yet played deletes nothing there.
        { spiel_id: "64b000000000000000000008", spiel_nr: 32, ...VOIDED_NONE },
      ],
      released_sides: [
        { spiel_id: "64b000000000000000000009", spiel_nr: 31, side: "team1", team_name: "Linde", ...VOIDED_NONE, voided_ergebnis: "2:0" },
      ],
    } satisfies FLPatchSpielDataResponse;

    const answer = await previewSpiel(saving({ tore1: "3", tore2: "1" }));

    expect(answer).toEqual({ ok: true, value: [31, 33] });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([`/spiele/${SPIEL_ID}?dry_run=true`]);
  });
});
