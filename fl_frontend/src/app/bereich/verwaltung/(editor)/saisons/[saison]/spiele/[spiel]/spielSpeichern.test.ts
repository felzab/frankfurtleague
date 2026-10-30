import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { spielStateKey } from "@/features/spiele/utils";

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
};

/** The fixture once the write stored the new time. */
const NACHHER: FLSpielJoinedAdmin = { ...GESPEICHERT, uhrzeit: "18:00:00" };

/** The write's answer where it moved no other fixture. */
const NICHTS_BEWEGT: FLPatchSpielDataResponse = {
  advanced_to: [],
  released_sides: [],
  bracket_faults: [],
};

/** The fixture the save reads before and after its write, every payload it sends, and what the write answers. */
const stand = vi.hoisted(() => ({
  gelesen: null as unknown,
  /** The fixture as the write stored it, read again for its fingerprint. */
  gespeichert: null as unknown,
  gesendet: [] as unknown[],
  /** The save's write landed, so its next read is of the stored fixture. */
  geschrieben: false,
  ablehnung: null as unknown,
  antwort: null as unknown,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth", () => ({ judgeAdminRequest: async () => ({ session: {} }) }));

vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => {
    const spiel = stand.geschrieben ? stand.gespeichert : stand.gelesen;
    return spiel === null ? null : { spiel };
  },
}));

vi.mock("@/core/generated/client/sdk", () => ({
  spielePatchSpielData: async (_id: string, payload: unknown) => {
    stand.gesendet.push(payload);
    if (stand.ablehnung !== null) throw stand.ablehnung;
    stand.geschrieben = true;
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
  stand.gespeichert = NACHHER;
  stand.gesendet = [];
  stand.geschrieben = false;
  stand.ablehnung = null;
  stand.antwort = NICHTS_BEWEGT;
});

const FINGERPRINT = spielStateKey(GESPEICHERT);

describe("the match editor's save", () => {
  it("sends the changes over every field the editor does not show, as stored, answering the stored fixture's fingerprint", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: true, value: spielStateKey(NACHHER) });
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

    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { sonderereignis: "nichtantreten_team1" } });

    expect(answer).toEqual({
      ok: true,
      value: spielStateKey(NACHHER),
      note: COPY.verwaltung.spiel.gespeichertMitFolgen(
        "Die Paarung in Spiel 31 wurde ebenfalls aktualisiert. Das eingetragene Ergebnis in Spiel 31 wurde dabei gelöscht.",
      ),
    });
  });

  it("refuses as stale a save on a fixture changed since the editor read it, writing nothing", async () => {
    stand.gelesen = { ...GESPEICHERT, datum: "2027-03-21" };

    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: false, reason: COPY.shared.fehler.veraltet });
    expect(stand.gesendet).toEqual([]);
  });

  it("drops the shoot-out with the event that ends the match's play, as today's editor does", async () => {
    await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { sonderereignis: "nichtantreten_team2" } });

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
    const fingerprint = spielStateKey(nichtangetreten);

    stand.gelesen = nichtangetreten;
    for (const sonderereignis of [KEIN_SONDEREREIGNIS, "annulliert", "nichtantreten_team1"]) {
      // Each save is made on the no-show as stored.
      stand.geschrieben = false;
      await spielSpeichern({ id: SPIEL_ID, fingerprint, changes: { sonderereignis } });
    }

    expect(stand.gesendet).toMatchObject([
      { sonderereignis: null, team1: { tore: null }, team2: { tore: null } },
      { sonderereignis: "annulliert", team1: { tore: null }, team2: { tore: null } },
      // Still a no-show, the other side's: the write composes the award afresh, whatever goals it is sent.
      { sonderereignis: "nichtantreten_team1", team1: { tore: 3 }, team2: { tore: 0 } },
    ]);
  });

  it("books no venue and no price where the venue is cleared", async () => {
    await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { spielort: null, mietpreis: "" } });

    expect(stand.gesendet).toMatchObject([{ ort: null }]);
  });

  it("keeps back a price that is not a figure on its field, writing nothing", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { mietpreis: "60 Euro" } });

    expect(answer).toEqual({
      ok: false,
      fieldErrors: { "changes.mietpreis": COPY.shared.feld.format(COPY.verwaltung.spielort.mietpreisBeispiel) },
    });
    expect(stand.gesendet).toEqual([]);
  });

  it("asks for a price while a venue is chosen, writing nothing", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { mietpreis: "" } });

    expect(answer).toEqual({ ok: false, fieldErrors: { "changes.mietpreis": COPY.shared.feld.pflichtfeld } });
    expect(stand.gesendet).toEqual([]);
  });

  it("places the write's refusal on the field that caused it, in the status line, or on the stale-page line", async () => {
    const save = { id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { datum: "2027-05-01" } } as const;

    stand.ablehnung = refusal("REQ-DATE-001");
    expect(await spielSpeichern(save)).toEqual({
      ok: false,
      errorCode: "REQ-DATE-001",
      fieldErrors: { "changes.datum": COPY.shared.ablehnung["REQ-DATE-001"] },
    });

    stand.ablehnung = refusal("REQ-CLASH-001");
    expect(await spielSpeichern(save)).toEqual({ ok: false, errorCode: "REQ-CLASH-001", reason: COPY.shared.ablehnung["REQ-CLASH-001"] });

    stand.ablehnung = refusal("REQ-BOOKING-003");
    expect(await spielSpeichern(save)).toEqual({ ok: false, errorCode: "REQ-BOOKING-003", reason: COPY.shared.fehler.veraltet });
  });
});
