import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { SERVER_COPY } from "@/core/serverCopy";

import { spielSpeichern } from "./spielSpeichern";
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
  ansetzung_bestaetigt: null,
  version: 3,
};

/** The write's answer where it moved no other fixture: the fixture's version after the save. */
const NICHTS_BEWEGT: FLPatchSpielDataResponse = {
  advanced_to: [],
  released_sides: [],
  bracket_faults: [],
  version: 4,
  bericht_uebernommen: null,
};

/** The fixture the save reads before its write, every payload it sends, and what the write answers. */
const stand = vi.hoisted(() => ({
  gelesen: null as unknown,
  gesendet: [] as unknown[],
  ablehnung: null as unknown,
  antwort: null as unknown,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => (stand.gelesen === null ? null : { spiel: stand.gelesen }),
}));

vi.mock("@/core/generated/client/sdk", () => ({
  spielePatchSpiel: async (_id: string, payload: unknown) => {
    stand.gesendet.push(payload);
    if (stand.ablehnung !== null) throw stand.ablehnung;
    return stand.antwort;
  },
}));

const refusal = (serverErrorCode: Code) =>
  new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0/spiele/${SPIEL_ID}`,
    statusCode: 409,
    serverErrorCode,
    endpoint: `/spiele/${SPIEL_ID}`,
    method: "PATCH",
    readOnly: false,
    traceId: "0",
  });

beforeEach(() => {
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
      note: COPY.verwaltung.spiel.gespeichertMitFolgen(
        "Die Paarung in Spiel 31 wurde ebenfalls aktualisiert. Das eingetragene Ergebnis in Spiel 31 wurde dabei gelöscht.",
      ),
    });
  });

  it("answers as stale a fixture gone since the editor read it, writing nothing", async () => {
    stand.gelesen = null;

    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
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
      fieldErrors: { "changes.mietpreis": COPY.shared.feld.format(COPY.verwaltung.spielort.mietpreisBeispiel) },
    });
    expect(stand.gesendet).toEqual([]);
  });

  it("asks for a price while a venue is chosen, writing nothing", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, version: VERSION, changes: { mietpreis: "" } });

    expect(answer).toEqual({ ok: false, fieldErrors: { "changes.mietpreis": COPY.shared.feld.pflichtfeld } });
    expect(stand.gesendet).toEqual([]);
  });

  it("places the write's refusal on the field that caused it, in the status line, or on the stale-page line", async () => {
    const save = { id: SPIEL_ID, version: VERSION, changes: { datum: "2027-05-01" } } as const;

    stand.ablehnung = refusal("spiel_outside_spieltag");
    expect(await spielSpeichern(save)).toEqual({
      ok: false,
      errorCode: "spiel_outside_spieltag",
      fieldErrors: { "changes.datum": SERVER_COPY.ablehnung["spiel_outside_spieltag"] },
    });

    stand.ablehnung = refusal("spiel_double_booked");
    expect(await spielSpeichern(save)).toEqual({
      ok: false,
      errorCode: "spiel_double_booked",
      reason: SERVER_COPY.ablehnung["spiel_double_booked"],
    });

    // The editor sets no team, so a team's refusal means the fixture changed under it.
    for (const code of [
      "booking_schiedsrichter_moved",
      "ergebnis_side_emptied",
      "spieltag_occupied",
      "spieltag_occupied_by_the_resolution",
      "eligibility_team_not_in_saison",
    ] as const) {
      stand.ablehnung = refusal(code);
      expect(await spielSpeichern(save), code).toEqual({ ok: false, errorCode: code, reason: COPY.shared.fehler.veraltet });
    }

    // The fixture changed since the editor read it: the write refused the version it was sent.
    stand.ablehnung = refusal("version_stale");
    expect(await spielSpeichern(save)).toEqual({ ok: false, errorCode: "version_stale", reason: COPY.shared.fehler.veraltet });
  });
});
