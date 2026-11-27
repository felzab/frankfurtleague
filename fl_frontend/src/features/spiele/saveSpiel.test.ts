import { beforeEach, describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

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
  spielort: { spielort_id: "64b000000000000000000005", name: "Sportpark Nord", maps_query: "Sportpark Nord, Frankfurt", mietpreis: 60 },
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
  spielort: { spielort_id: "64b000000000000000000005", mietpreis: 60 },
  schiedsrichter: { schiedsrichter_id: "64b000000000000000000006", payment: 25 },
  team1: { team_id: "64b000000000000000000003", tore: 2 },
  team2: { team_id: "64b000000000000000000004", tore: 2 },
  team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" },
  team2_quelle: { type: "spiel", spiel_nr: 26, ausgang: "sieger" },
  elfmeterschiessen: { team1: 4, team2: 3 },
  sonderereignis: null,
  note: "Flutlicht",
  version: 3,
  // The later results the save deletes: none here.
  voided_ergebnisse: [],
} satisfies FLPatchSpielDataPayload;

/** The write's answer where it moved no other fixture: the fixture's version after the save. */
const NOTHING_MOVED: FLPatchSpielDataResponse = {
  advanced_to: [],
  released_sides: [],
  version: 4,
  recipients: null,
  voided_ergebnisse: [],
};

const VOIDED_NONE = { voided_ergebnis: null, voided_elfmeterschiessen: null, voided_sonderereignis: null };

/**
 * The fixture the save reads before its write, every payload it writes, what the write answers, and what the write's
 * dry run reports, which names the results the write would delete.
 */
const state = {
  read: null as unknown,
  sent: [] as unknown[],
  answer: null as unknown,
  dryRun: null as unknown,
  // What the backend comes to hold once it has answered a request, a later result entered or removed between two
  // requests of one press: called with the request's endpoint after its answer is composed.
  answered: null as ((endpoint: string) => void) | null,
};

/** Every request the save made of the write's endpoint, its dry run's among them, with its query. */
const calls: { endpoint: string; method: string }[] = [];

/** The dry run's report, or the write's answer: a refusal where it names other results to delete than the report. */
function patched(dryRun: boolean, body: FLPatchSpielDataPayload) {
  const report = state.dryRun as FLPatchSpielDataResponse;
  if (dryRun) return report;
  if (JSON.stringify(body.voided_ergebnisse ?? []) !== JSON.stringify(report.voided_ergebnisse)) return refusal("voided_results_stale");
  state.sent.push(body);
  return state.answer;
}

// The backend answers the editor's read with the fixture, the dry run with its report and the write with its answer,
// so the save runs through the real guard, read, generated call and dispatch, which counts the write. A write naming
// other results to delete than those its dry run reports is refused, as the backend refuses it, and writes nothing.
serveBackend(({ method, path, search, body }) => {
  if (method === "GET" && path === `/spiele/${SPIEL_ID}`) return { spiel: state.read };
  if (method !== "PATCH" || path !== `/spiele/${SPIEL_ID}`) return undefined;

  const endpoint = search.size > 0 ? `${path}?${search.toString()}` : path;
  calls.push({ endpoint, method });
  const answer = patched(search.get("dry_run") === "true", body as FLPatchSpielDataPayload);
  state.answered?.(endpoint);
  return answer;
});
// An administrator's session, made by passkey, which the save's guard admits.
signedInRequest();

const { saveSpiel } = await import("./saveSpiel");

const DRY_RUN = `/spiele/${SPIEL_ID}?dry_run=true`;

beforeEach(() => {
  calls.length = 0;
  state.read = STORED;
  state.sent = [];
  state.answer = NOTHING_MOVED;
  state.dryRun = NOTHING_MOVED;
  state.answered = null;
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
    // The write alone, deleting nothing here, so no dry run is asked, and no report stamped.
    expect(calls.map(({ endpoint, method }) => ({ endpoint, method }))).toStrictEqual([{ endpoint: `/spiele/${SPIEL_ID}`, method: "PATCH" }]);
    expect(state.sent).toEqual([{ ...SENT_AS_STORED, time: "18:00:00" }]);
  });

  // The harm: a report agreeing with a result typed in by hand, never adopted, so its cards never reach the public page.
  it("sends a save changing no field that adopts the report to the write, stamping that report's version", async () => {
    const answer = await saveSpiel({ ...saving({}), adoptsBericht: 2 });

    expect(answer).toEqual({ ok: true, value: 4 });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([`/spiele/${SPIEL_ID}?adopts_bericht=2`]);
    expect(state.sent).toEqual([SENT_AS_STORED]);
  });

  // The harm: a played match whose referee was erased loses its booking and the fee it recorded on any save of it.
  it("sends a booking naming nobody back as one, with its fee", async () => {
    state.read = { ...STORED, schiedsrichter: { schiedsrichter_id: null, name: null, payment: 25 } };

    await saveSpiel(saving({ time: "18:00:00" }));

    expect(state.sent).toEqual([{ ...SENT_AS_STORED, time: "18:00:00", schiedsrichter: { schiedsrichter_id: null, payment: 25 } }]);
  });

  it("stands a hand-picked club on its side without the side's source, which the bracket would otherwise put back", async () => {
    await saveSpiel(saving({ team2: PICKED }));

    expect(state.sent).toMatchObject([
      { team1: SENT_AS_STORED.team1, team1_quelle: SENT_AS_STORED.team1_quelle, team2: { team_id: PICKED, tore: 2 }, team2_quelle: null },
    ]);
  });

  // The note is the one place the person learns the write moved other fixtures.
  it("names each other fixture once, a released side's among them, in its number's order", async () => {
    // One fixture both moved and released a side, and one only released it.
    state.answer = { ...NOTHING_MOVED, advanced_to: [31, 12], released_sides: [12, 7] } satisfies FLPatchSpielDataResponse;

    const answer = await saveSpiel(saving({ time: "18:00:00" }));

    expect(answer).toEqual({ ok: true, value: 4, note: ADMIN_COPY.spiel.alsoChanged([7, 12, 31]) });
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

    // „Keines“, the select's empty entry, which the save reads as no event.
    await saveSpiel(saving({ sonderereignis: "" }));

    expect(state.sent).toMatchObject([{ sonderereignis: null, team1: { tore: null }, team2: { tore: null } }]);
  });

  it("asks for each booking's money and each side's goals the save needs, writing nothing", async () => {
    const answer = await saveSpiel(saving({ mietpreis: "", payment: "", tore1: "", tore2: "" }));

    const required = COPY.shared.field.required;
    expect(answer).toStrictEqual({
      ok: false,
      fieldErrors: { "changes.mietpreis": required, "changes.payment": required, "changes.tore1": required, "changes.tore2": required },
      kinds: { "changes.mietpreis": "required", "changes.payment": "required", "changes.tore1": "required", "changes.tore2": "required" },
    });
    expect(state.sent).toEqual([]);
  });

  // The harm: a knockout's level match saved with one shoot-out figure, which the write cannot carry half of: the
  // save would send no shoot-out and drop the typed figure, leaving the match undecided with nothing said.
  it("asks for the shoot-out's other figure once one is typed, writing nothing", async () => {
    const answer = await saveSpiel(saving({ shootOut2: "" }));

    expect(answer).toStrictEqual({
      ok: false,
      fieldErrors: { "changes.shootOut2": COPY.shared.field.required },
      kinds: { "changes.shootOut2": "required" },
    });
    expect(state.sent).toEqual([]);
  });

  // The harm: a double booking, a retired venue, an unconfirmed referee or a departed club marks no box, its phrase
  // shown nowhere, since the write names each by the path its payload nests the resource under.
  it("stands each fault the write names on the box of the resource it nests, by the write's own paths", async () => {
    const body = { ctx: {}, in: "body" } as const;
    state.answer = refusal("spiel_double_booked", {
      status: 409,
      fields: [
        { ...body, kind: "spiel_double_booked", path: ["spielort", "spielort_id"] },
        { ...body, kind: "eligibility_disqualified", path: ["team1", "team_id"] },
      ],
    });

    const answer = await saveSpiel(saving({ spielort: PICKED }));

    expect(answer).toStrictEqual({
      ok: false,
      errorCode: "spiel_double_booked",
      fieldErrors: { "changes.spielort": COPY.shared.field.taken, "changes.team1": ADMIN_COPY.spiel.departed },
      kinds: { "changes.spielort": "spiel_double_booked", "changes.team1": "eligibility_disqualified" },
    });
  });
});

// The harm: a save deleting later matches' stored results unasked, which only its done line names afterwards.
describe("the match editor's question before it deletes a later result", () => {
  const VOIDED_33 = { spiel_id: "64b000000000000000000007", spiel_nr: 33, ...VOIDED_NONE, voided_ergebnis: "1:0" };
  const VOIDED_31 = { spiel_id: "64b000000000000000000009", spiel_nr: 31, ...VOIDED_NONE, voided_ergebnis: "2:0" };

  beforeEach(() => {
    state.dryRun = {
      ...NOTHING_MOVED,
      // An occupant moved into match 32, not yet played, deletes nothing there.
      advanced_to: [33, 32],
      released_sides: [31],
      voided_ergebnisse: [VOIDED_31, VOIDED_33],
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

    expect(question).toMatchObject({ subject: COPY.spielplan.ergebnis, consequence: ADMIN_COPY.spiel.voids([31, 33]) });
    expect(question).not.toHaveProperty("facts");
    // The write, refused for the results it would delete unasked, and then the dry run that words the question.
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([`/spiele/${SPIEL_ID}`, DRY_RUN]);
    expect(state.sent).toEqual([]);
  });

  it("writes once the person confirmed it, naming to the write exactly the results it was asked about", async () => {
    const { confirm } = await asked({ tore1: "3", tore2: "1" });

    const answer = await saveSpiel({ ...saving({ tore1: "3", tore2: "1" }), confirm });

    expect(answer).toMatchObject({ ok: true, value: 4 });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([`/spiele/${SPIEL_ID}`, DRY_RUN, DRY_RUN, `/spiele/${SPIEL_ID}`]);
    // The write is the gate: it deletes these and refuses where its own transaction would delete others.
    expect(state.sent).toMatchObject([{ voided_ergebnisse: [VOIDED_31, VOIDED_33] }]);
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
      { label: ADMIN_COPY.facts.mailTo, value: { record: "Ernst-Reuter-Schule, Lena Brandt und Lessing-Gymnasium" } },
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

    for (const voided_ergebnisse of since) {
      state.dryRun = { ...(state.dryRun as FLPatchSpielDataResponse), voided_ergebnisse };
      expect(await saveSpiel({ ...saving({ tore1: "3", tore2: "1" }), confirm })).toMatchObject({ ok: false, ask: {} });
    }
    expect(state.sent).toEqual([]);
  });

  it("asks again, from one more dry run, where a result entered after the confirmed dry run has the write refuse", async () => {
    const { confirm } = await asked({ tore1: "3", tore2: "1" });
    calls.length = 0;
    const VOIDED_35 = { spiel_id: "64b00000000000000000000b", spiel_nr: 35, ...VOIDED_NONE, voided_ergebnis: "0:1" };
    const confirmed = state.dryRun as FLPatchSpielDataResponse;
    // Match 35's result entered once the confirming press's dry run has answered, so its write names one result too few.
    state.answered = (endpoint) => {
      if (endpoint === DRY_RUN) state.dryRun = { ...confirmed, voided_ergebnisse: [...confirmed.voided_ergebnisse, VOIDED_35] };
    };

    const answer = await saveSpiel({ ...saving({ tore1: "3", tore2: "1" }), confirm });

    expect(answer).toMatchObject({ ok: false, ask: { consequence: ADMIN_COPY.spiel.voids([31, 33, 35]) } });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([DRY_RUN, `/spiele/${SPIEL_ID}`, DRY_RUN]);
    expect(state.sent).toEqual([]);
  });

  // The harm: a save that would now delete nothing answered „Das löscht ein späteres Ergebnis.“, untrue at that
  // moment, so the person gives up a save a second press would land.
  it("answers the stale-page line where the result the write refused to delete is gone before its dry run", async () => {
    // Matches 31's and 33's results removed once the write has refused, so its dry run finds nothing to delete.
    state.answered = (endpoint) => {
      if (endpoint === `/spiele/${SPIEL_ID}`) state.dryRun = NOTHING_MOVED;
    };

    const answer = await saveSpiel(saving({ tore1: "3", tore2: "1" }));

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([`/spiele/${SPIEL_ID}`, DRY_RUN]);
    expect(state.sent).toEqual([]);
  });
});
