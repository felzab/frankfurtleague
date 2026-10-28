import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { spielStateKey } from "@/features/spiele/utils";

import { spielSpeichern } from "./spielSpeichern";

import type { FLPatchSpielDataPayload, FLSpielAdmin } from "@/features/spiele/schemas";

const SPIEL_ID = "64b000000000000000000001";

/** A knockout fixture with every field the editor does not show set, so a save dropping one is seen. */
const GESPEICHERT: FLSpielAdmin = {
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

/** The fixture the save reads afresh, and every payload it sends to the write. */
const stand = vi.hoisted(() => ({
  gelesen: null as unknown,
  gesendet: [] as unknown[],
  ablehnung: null as unknown,
}));

vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => (stand.gelesen === null ? null : { spiel: stand.gelesen }),
}));

vi.mock("@/features/spiele/mutations", () => ({
  patchAdminSpielData: async (payload: unknown) => {
    stand.gesendet.push(payload);
    if (stand.ablehnung !== null) throw stand.ablehnung;
    return { acknowledged: true };
  },
}));

// The guard's spine runs the body for a session it judged; its own refusals are not this save's.
vi.mock("@/shared/utils/adminMutation", () => ({
  runAdminMutation: async (_name: string, body: () => Promise<unknown>) => body(),
  invalidatesOnWrite: () => undefined,
}));

const refusal = (serverErrorCode: string) =>
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
});

const FINGERPRINT = spielStateKey(GESPEICHERT);

describe("the match editor's save", () => {
  it("sends the changes over every field the editor does not show, as stored", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } });

    expect(answer).toEqual({ ok: true, value: undefined });
    expect(stand.gesendet).toEqual([
      {
        spiel_id: SPIEL_ID,
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

  it("books no venue and no price where the venue is cleared", async () => {
    await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { spielort: null, mietpreis: "" } });

    expect(stand.gesendet).toMatchObject([{ ort: null }]);
  });

  it("keeps back a price that is not a figure on its field, writing nothing", async () => {
    const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { mietpreis: "60 Euro" } });

    expect(answer).toEqual({
      ok: false,
      fieldErrors: { mietpreis: COPY.shared.feld.format(COPY.verwaltung.spielort.mietpreisBeispiel) },
    });
    expect(stand.gesendet).toEqual([]);
  });

  it("places the write's refusal on the field that caused it, or in the status line", async () => {
    stand.ablehnung = refusal("REQ-DATE-001");
    expect(await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { datum: "2027-05-01" } })).toEqual({
      ok: false,
      fieldErrors: { datum: COPY.verwaltung.spiel.abgelehnt.datumAusserhalb },
    });

    stand.ablehnung = refusal("REQ-BOOKING-003");
    expect(await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { datum: "2027-05-01" } })).toEqual({
      ok: false,
      reason: COPY.shared.fehler.veraltet,
    });
  });
});
