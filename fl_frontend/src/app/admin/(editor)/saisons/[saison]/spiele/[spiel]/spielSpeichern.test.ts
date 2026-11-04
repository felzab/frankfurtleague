import { doubleApiClient } from "@/test-support/apiClientDouble";
import { bodyField } from "@/test-support/refusedPayload";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

import { KEIN_SONDEREREIGNIS } from "./spielWerte";

import type { Code, FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLSpielJoinedAdmin } from "@/core/generated/client/types";

const SPIEL_ID = "64b000000000000000000001";

/** A knockout fixture with every field the editor does not show set, so a save dropping one is seen. */
const GESPEICHERT: FLSpielJoinedAdmin = {
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

/** The write's answer where it moved no other fixture: the fixture's version after the save. */
const NICHTS_BEWEGT: FLPatchSpielDataResponse = {
  advanced_to: [],
  released_sides: [],
  bracket_faults: [],
  version: 4,
  bericht_adopted: null,
};

/** The fixture the save reads before its write, every payload it sends, and what the write answers. */
const stand = vi.hoisted(() => ({
  gelesen: null as unknown,
  gesendet: [] as unknown[],
  ablehnung: null as unknown,
  antwort: null as unknown,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action, and the write the real dispatch counts reaches it; whether a
// save clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => (stand.gelesen === null ? null : { spiel: stand.gelesen }),
}));

// The backend client itself is replaced, so the write runs through the real generated call and the real dispatch,
// which counts it and takes it back where the backend refuses it.
const calls = doubleApiClient((call) => {
  stand.gesendet.push(JSON.parse(call.body ?? "null"));
  if (stand.ablehnung !== null) throw stand.ablehnung;
  return stand.antwort;
});

const { spielSpeichern } = await import("./spielSpeichern");

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
  stand.gelesen = GESPEICHERT;
  stand.gesendet = [];
  stand.ablehnung = null;
  stand.antwort = NICHTS_BEWEGT;
});

/** The version the editor was read at. */
const VERSION = GESPEICHERT.version;

describe("the match editor's save", () => {
  it("sends the changes over every field the editor does not show, as stored, on the version it read, answering the new one", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: true, value: 4 });
    // The write itself, never its dry run.
    expect(calls.map(({ endpoint, method }) => ({ endpoint, method }))).toStrictEqual([{ endpoint: `/spiele/${SPIEL_ID}`, method: "PATCH" }]);
    expect(stand.gesendet).toEqual([
      {
        datum: "2027-03-14",
        uhrzeit: "18:00:00",
        ort: { spielort_id: "64b000000000000000000005", mietpreis: 60 },
        schiedsrichter: { schiedsrichter_id: "64b000000000000000000006", payment: 25 },
        team1: { team_id: "64b000000000000000000003", tore: 2 },
        team2: { team_id: "64b000000000000000000004", tore: 2 },
        team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" },
        team2_quelle: { type: "spiel", spiel_nr: 26, ausgang: "sieger" },
        elfmeterschiessen: { team1: 4, team2: 3 },
        sonderereignis: null,
        notiz: "Flutlicht",
        schiedsrichter_stand: "64b000000000000000000006",
        version: 3,
      } satisfies FLPatchSpielDataPayload,
    ]);
  });

  it("says which other fixture the write moved, and the result it deleted there", async () => {
    stand.antwort = {
      ...NICHTS_BEWEGT,
      advanced_to: [
        {
          spiel_id: "64b000000000000000000007",
          spiel_nr: 31,
          voided_ergebnis: "1:0",
          voided_elfmeterschiessen: null,
          voided_sonderereignis: null,
        },
      ],
    } satisfies FLPatchSpielDataResponse;

    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { sonderereignis: "nichtantreten_team1" } });

    expect(answer).toEqual({
      ok: true,
      value: 4,
      note: COPY.verwaltung.spiel.alsoChanged([31]),
    });
  });

  it("names each other fixture once, a released side's among them, in its number's order", async () => {
    const voided = { voided_ergebnis: null, voided_elfmeterschiessen: null, voided_sonderereignis: null };
    stand.antwort = {
      ...NICHTS_BEWEGT,
      advanced_to: [
        { spiel_id: "64b000000000000000000007", spiel_nr: 31, ...voided },
        { spiel_id: "64b000000000000000000008", spiel_nr: 12, ...voided },
      ],
      // One fixture both moved and released a side, and one only released it.
      released_sides: [
        { spiel_id: "64b000000000000000000008", spiel_nr: 12, side: "team2", team_name: "Weide", ...voided },
        { spiel_id: "64b000000000000000000009", spiel_nr: 7, side: "team1", team_name: "Linde", ...voided },
      ],
    } satisfies FLPatchSpielDataResponse;

    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: true, value: 4, note: COPY.verwaltung.spiel.alsoChanged([7, 12, 31]) });
  });

  it("answers as stale a fixture gone since the editor read it, writing nothing", async () => {
    stand.gelesen = null;

    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(stand.gesendet).toEqual([]);
  });

  it("drops the shoot-out with the event that ends the match's play, as today's editor does", async () => {
    await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { sonderereignis: "nichtantreten_team2" } });

    expect(stand.gesendet).toMatchObject([{ sonderereignis: "nichtantreten_team2", elfmeterschiessen: null }]);
  });

  it("drops a no-show's awarded goals with the no-show, so they never stand as a played result", async () => {
    const nichtangetreten: FLSpielJoinedAdmin = {
      ...GESPEICHERT,
      team1: { team_id: "64b000000000000000000003", name: "Woehlerschule", shorthand: "WO", tore: 3, austritt_type: null },
      team2: { team_id: "64b000000000000000000004", name: "Ernst-Reuter-Schule", shorthand: "ER", tore: 0, austritt_type: null },
      ergebnis: "3:0",
      elfmeterschiessen: null,
      sonderereignis: "nichtantreten_team2",
    };
    const { version } = nichtangetreten;

    stand.gelesen = nichtangetreten;
    for (const sonderereignis of [KEIN_SONDEREREIGNIS, "annulliert", "nichtantreten_team1"]) {
      // Each save is made on the no-show as stored.
      await spielSpeichern({ id: SPIEL_ID, version, changes: { sonderereignis } });
    }

    expect(stand.gesendet).toMatchObject([
      { sonderereignis: null, team1: { tore: null }, team2: { tore: null } },
      { sonderereignis: "annulliert", team1: { tore: null }, team2: { tore: null } },
      // Still a no-show, the other side's: the write composes the award afresh, whatever goals it is sent.
      { sonderereignis: "nichtantreten_team1", team1: { tore: 3 }, team2: { tore: 0 } },
    ]);
  });

  it("books no venue and no price where the venue is cleared", async () => {
    await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { spielort: null, mietpreis: "" } });

    expect(stand.gesendet).toMatchObject([{ ort: null }]);
  });

  it("keeps back a price that is not a figure on its field, writing nothing", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { mietpreis: "60 Euro" } });

    expect(answer).toEqual({
      ok: false,
      fieldErrors: { "changes.mietpreis": COPY.shared.field.format(COPY.verwaltung.spielort.mietpreisExample) },
    });
    expect(stand.gesendet).toEqual([]);
  });

  it("asks for a price while a venue is chosen, writing nothing", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { mietpreis: "" } });

    expect(answer).toEqual({ ok: false, fieldErrors: { "changes.mietpreis": COPY.shared.field.required } });
    expect(stand.gesendet).toEqual([]);
  });

  it("places the write's refusal on the field that caused it, in the status line, or on the stale-page line", async () => {
    const save = { id: SPIEL_ID, version: VERSION, changes: { datum: "2027-05-01" } } as const;

    // A field pattern's phrase, by the path the write names, onto the editor's box for it.
    stand.ablehnung = refusal("state_ergebnis_on_a_non_event", ["sonderereignis"]);
    expect(await spielSpeichern(save)).toEqual({
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
      stand.ablehnung = refusal(code, about);
      expect(await spielSpeichern(save), `${code} ${about.join(".")}`).toEqual({ ok: false, errorCode: code, reason });
    }

    // A finished season refuses the write whole, so its line stands alone on the bar.
    stand.ablehnung = refusal("saison_past");
    expect(await spielSpeichern(save)).toEqual({ ok: false, errorCode: "saison_past", reason: SERVER_COPY.refusalLine.saison_past });

    // The editor sets no team, so a team's refusal means the fixture changed under it.
    for (const code of [
      "booking_schiedsrichter_moved",
      "ergebnis_side_emptied",
      "spieltag_occupied",
      "spieltag_occupied_by_the_resolution",
      "eligibility_team_not_in_saison",
    ] as const) {
      stand.ablehnung = refusal(code);
      expect(await spielSpeichern(save), code).toEqual({ ok: false, errorCode: code, reason: COPY.shared.failure.stale });
    }

    // The fixture changed since the editor read it: the write refused the version it was sent.
    stand.ablehnung = refusal("version_stale");
    expect(await spielSpeichern(save)).toEqual({ ok: false, errorCode: "version_stale", reason: COPY.shared.failure.stale });
  });
});
