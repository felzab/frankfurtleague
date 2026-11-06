import { doubleApiClient } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { NO_SONDEREREIGNIS } from "./spielValues";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLSpielJoinedAdmin } from "@/core/generated/client/types";

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
  date: "2027-03-14",
  time: "15:30:00",
  ort: { spielort_id: "64b000000000000000000005", name: "Sportpark Nord", maps_link: "Sportpark Nord, Frankfurt", mietpreis: 60 },
  schiedsrichter: { schiedsrichter_id: "64b000000000000000000006", name: "Lena Brandt", payment: 25 },
  ergebnis: "2:2",
  elfmeterschiessen: { team1: 4, team2: 3 },
  spiel_nr: 29,
  sonderereignis: null,
  saison_phase: "halbfinale",
  saison_id: "2027",
  note: "Flutlicht",
  ansetzung_confirmed: null,
  for_third_place: false,
  version: 3,
};

/** The fixture as the write is sent it where the editor changed nothing it shows. */
const SENT_AS_STORED = {
  date: "2027-03-14",
  time: "15:30:00",
  ort: { spielort_id: "64b000000000000000000005", mietpreis: 60 },
  schiedsrichter: { schiedsrichter_id: "64b000000000000000000006", payment: 25 },
  team1: { team_id: "64b000000000000000000003", tore: 2 },
  team2: { team_id: "64b000000000000000000004", tore: 2 },
  team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" },
  team2_quelle: { type: "spiel", spiel_nr: 26, ausgang: "sieger" },
  elfmeterschiessen: { team1: 4, team2: 3 },
  sonderereignis: null,
  note: "Flutlicht",
  version: 3,
  // The later results the save deletes, as its dry run answered: none here.
  voided_results: [],
} satisfies FLPatchSpielDataPayload;

/** The write's answer where it moved no other fixture: the fixture's version after the save. */
const NOTHING_MOVED: FLPatchSpielDataResponse = {
  advanced_to: [],
  released_sides: [],
  bracket_faults: [],
  version: 4,
  bericht_adopted: null,
  recipients: null,
  voided_results: [],
};

const VOIDED_NONE = { voided_ergebnis: null, voided_elfmeterschiessen: null, voided_sonderereignis: null };

/**
 * The fixture the save reads before its write, every payload it writes, what the write answers, and what the write's
 * dry run, asked first, reports.
 */
const state = vi.hoisted(() => ({
  read: null as unknown,
  sent: [] as unknown[],
  answer: null as unknown,
  dryRun: null as unknown,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action, and the write the real dispatch counts reaches it; whether a
// save clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

// The editor's view as far as the save reads it: the fixture.
vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => ({ spiel: state.read }),
}));

// The backend client itself is replaced, so the write runs through the real generated call and the real dispatch,
// which counts it.
const calls = doubleApiClient((call) => {
  if (call.endpoint.includes("dry_run=true")) return state.dryRun;
  state.sent.push(JSON.parse(call.body ?? "null"));
  return state.answer;
});

const { saveSpiel } = await import("./saveSpiel");

const DRY_RUN = `/spiele/${SPIEL_ID}?dry_run=true`;

beforeEach(() => {
  calls.length = 0;
  state.read = STORED;
  state.sent = [];
  state.answer = NOTHING_MOVED;
  state.dryRun = NOTHING_MOVED;
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
    const answer = await saveSpiel(saving({ time: "18:00:00" }));

    expect(answer).toEqual({ ok: true, value: 4 });
    // The dry run first, deleting nothing here, then the write itself, and no report stamped.
    expect(calls.map(({ endpoint, method }) => ({ endpoint, method }))).toStrictEqual([
      { endpoint: DRY_RUN, method: "PATCH" },
      { endpoint: `/spiele/${SPIEL_ID}`, method: "PATCH" },
    ]);
    expect(state.sent).toEqual([{ ...SENT_AS_STORED, time: "18:00:00" }]);
  });

  it("stands a hand-picked club on its side without the side's source, which the bracket would otherwise put back", async () => {
    await saveSpiel(saving({ team2: PICKED }));

    expect(state.sent).toMatchObject([
      { team1: SENT_AS_STORED.team1, team1_quelle: SENT_AS_STORED.team1_quelle, team2: { team_id: PICKED, tore: 2 }, team2_quelle: null },
    ]);
  });

  // The note is the one place the person learns the write moved other fixtures.
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

    const answer = await saveSpiel(saving({ time: "18:00:00" }));

    expect(answer).toEqual({ ok: true, value: 4, note: COPY.admin.spiel.alsoChanged([7, 12, 31]) });
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

  it("asks for each booking's money and each side's goals the save needs, writing nothing", async () => {
    const answer = await saveSpiel(saving({ mietpreis: "", payment: "", tore2: "" }));

    const required = COPY.shared.field.required;
    expect(answer).toEqual({
      ok: false,
      fieldErrors: { "changes.mietpreis": required, "changes.payment": required, "changes.tore2": required },
    });
    expect(state.sent).toEqual([]);
  });
});

// The harm: a save deleting later matches' stored results unasked, which only its done line names afterwards.
describe("the match editor's question before it deletes a later result", () => {
  const VOIDED_33 = { spiel_id: "64b000000000000000000007", spiel_nr: 33, ...VOIDED_NONE, voided_ergebnis: "1:0" };
  const VOIDED_31 = { spiel_id: "64b000000000000000000009", spiel_nr: 31, ...VOIDED_NONE, voided_ergebnis: "2:0" };

  beforeEach(() => {
    state.dryRun = {
      ...NOTHING_MOVED,
      advanced_to: [
        VOIDED_33,
        // An occupant moved into a match not yet played deletes nothing there.
        { spiel_id: "64b000000000000000000008", spiel_nr: 32, ...VOIDED_NONE },
      ],
      released_sides: [{ ...VOIDED_31, side: "team1", team_name: "Linde" }],
      voided_results: [VOIDED_31, VOIDED_33],
    } satisfies FLPatchSpielDataResponse;
  });

  /** The question a save of these changes answers with first, whose token a confirmation of it sends back. */
  const asked = async (changes: Parameters<typeof saving>[0]) => {
    const answer = await saveSpiel(saving(changes));
    if (answer.ok || answer.ask === undefined) throw new Error("the save asked nothing");
    return answer.ask;
  };

  it("holds the save back with its question, naming the matches the write's own dry run would delete, and writes nothing", async () => {
    const question = await asked({ tore1: "3", tore2: "1" });

    expect(question).toMatchObject({ subject: COPY.admin.spiel.ergebnis, consequence: COPY.admin.spiel.voids([31, 33]) });
    expect(question).not.toHaveProperty("facts");
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([DRY_RUN]);
    expect(state.sent).toEqual([]);
  });

  it("writes once the person confirmed it, naming to the write exactly the results it was asked about", async () => {
    const { confirm } = await asked({ tore1: "3", tore2: "1" });

    const answer = await saveSpiel({ ...saving({ tore1: "3", tore2: "1" }), confirm });

    expect(answer).toMatchObject({ ok: true, value: 4 });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([DRY_RUN, DRY_RUN, `/spiele/${SPIEL_ID}`]);
    // The write is the gate: it deletes these and refuses where its own transaction would delete others.
    expect(state.sent).toMatchObject([{ voided_results: [VOIDED_31, VOIDED_33] }]);
  });

  it("names to the write that it deletes nothing where it asked nothing", async () => {
    state.dryRun = NOTHING_MOVED;

    await saveSpiel(saving({ tore1: "3", tore2: "1" }));

    expect(state.sent).toMatchObject([{ voided_results: [] }]);
  });

  it("names under its question whom the save mails, by the dry run's names in their order, and asks again where they change", async () => {
    state.dryRun = {
      ...(state.dryRun as FLPatchSpielDataResponse),
      recipients: [
        { kind: "schiedsrichter", schiedsrichter_id: "64b000000000000000000006", name: "Lena Brandt" },
        { kind: "team", team_id: PICKED, name: "Lessing-Gymnasium" },
        { kind: "team", team_id: "64b000000000000000000004", name: "Ernst-Reuter-Schule" },
      ],
    };
    const question = await asked({ team1: PICKED });

    expect(question.facts).toEqual([
      { label: COPY.admin.facts.mailTo, value: { record: "Ernst-Reuter-Schule, Lena Brandt und Lessing-Gymnasium" } },
    ]);

    // The same parties served in another order are the same question.
    const served = state.dryRun as FLPatchSpielDataResponse;
    state.dryRun = { ...served, recipients: (served.recipients ?? []).toReversed() };
    expect(await saveSpiel({ ...saving({ team1: PICKED }), confirm: question.confirm })).toMatchObject({ ok: true });

    // A confirmation covers no mail it was not shown.
    state.sent = [];
    state.dryRun = { ...served, recipients: [{ kind: "team", team_id: PICKED, name: "Lessing-Gymnasium" }] };
    expect(await saveSpiel({ ...saving({ team1: PICKED }), confirm: question.confirm })).toMatchObject({ ok: false, ask: {} });
    expect(state.sent).toEqual([]);
  });

  it("asks again where the save would now delete other results than those confirmed, or another value of one", async () => {
    const { confirm } = await asked({ tore1: "3", tore2: "1" });
    const since = [
      [VOIDED_33],
      // Match 31's 2:0 corrected to 3:0 since the question: a confirmation given while 2:0 stood covers no other.
      [{ ...VOIDED_31, voided_ergebnis: "3:0" }, VOIDED_33],
    ];

    for (const voided_results of since) {
      state.dryRun = { ...(state.dryRun as FLPatchSpielDataResponse), voided_results };
      expect(await saveSpiel({ ...saving({ tore1: "3", tore2: "1" }), confirm })).toMatchObject({ ok: false, ask: {} });
    }
    expect(state.sent).toEqual([]);
  });
});
