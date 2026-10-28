import { publishedRefusals, refusedOn } from "@/test-support/publishedRefusals.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { spielStateKey } from "@/features/spiele/utils";

import { spielSpeichern } from "./spielSpeichern";
import { KEIN_SONDEREREIGNIS } from "./spielWerte";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLSpielAdmin } from "@/features/spiele/schemas";

const SPEICHERN = "PATCH /spiele/{spiel_id}";

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

/** The write's answer where it moved no other fixture. */
const NICHTS_BEWEGT: FLPatchSpielDataResponse = {
  acknowledged: 1,
  advanced_to: [],
  released_sides: [],
  bracket_faults: [],
  prior_paarungen: [],
  prior_bericht: null,
};

/** The fixture the save reads afresh, every payload it sends to the write, and what the write answers. */
const stand = vi.hoisted(() => ({
  gelesen: null as unknown,
  gesendet: [] as unknown[],
  ablehnung: null as unknown,
  antwort: null as unknown,
  /** Why the guard turns the save away, or `null` where it admits it. */
  abgewiesen: null as string | null,
  /** The spine found that a write it sent may stand, whatever the body made of it. */
  unklar: false,
}));

vi.mock("@/features/spiele/queries", () => ({
  getAdminSpiel: async () => (stand.gelesen === null ? null : { spiel: stand.gelesen }),
}));

vi.mock("@/features/spiele/mutations", () => ({
  patchAdminSpielData: async (payload: unknown) => {
    stand.gesendet.push(payload);
    if (stand.ablehnung !== null) throw stand.ablehnung;
    return stand.antwort;
  },
}));

// The guard's spine: it turns a session away with the save's own `turnedAway`, or runs the body and answers
// its own unclear outcome where the write it sent may stand.
vi.mock("@/shared/utils/adminMutation", () => ({
  runAdminMutation: async (_name: string, declared: { turnedAway: (grund: string) => string }, body: () => Promise<unknown>) => {
    if (stand.abgewiesen !== null) return { success: false, error: declared.turnedAway(stand.abgewiesen) };
    const answer = await body();
    return stand.unklar ? { success: false, error: "Ob gespeichert wurde, ist unklar.", outcome: "unknown" } : answer;
  },
  FORBIDDEN_BY_REFUSAL: { signIn: "abgelaufen", noGrant: "kein Zugang", grantGone: "kein Zugang", unread: "ungelesen" },
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
  stand.antwort = NICHTS_BEWEGT;
  stand.abgewiesen = null;
  stand.unklar = false;
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
      value: undefined,
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
    const nichtangetreten: FLSpielAdmin = {
      ...GESPEICHERT,
      team1: { team_id: "64b000000000000000000003", name: "Woehlerschule", shorthand: "WO", tore: 3, austritt_type: null },
      team2: { team_id: "64b000000000000000000004", name: "Ernst-Reuter-Schule", shorthand: "ER", tore: 0, austritt_type: null },
      ergebnis: "3:0",
      elfmeterschiessen: null,
      sonderereignis: "nichtantreten_team2",
    };
    stand.gelesen = nichtangetreten;
    const fingerprint = spielStateKey(nichtangetreten);

    await spielSpeichern({ id: SPIEL_ID, fingerprint, changes: { sonderereignis: KEIN_SONDEREREIGNIS } });
    await spielSpeichern({ id: SPIEL_ID, fingerprint, changes: { sonderereignis: "annulliert" } });
    // Still a no-show, the other side's: the write composes the award afresh, whatever goals it is sent.
    await spielSpeichern({ id: SPIEL_ID, fingerprint, changes: { sonderereignis: "nichtantreten_team1" } });

    expect(stand.gesendet).toMatchObject([
      { sonderereignis: null, team1: { tore: null }, team2: { tore: null } },
      { sonderereignis: "annulliert", team1: { tore: null }, team2: { tore: null } },
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

  it("answers every refusal the match write publishes in words of its own", async () => {
    // A rule's code reaches the editor whatever status the backend answers it at.
    for (const code of publishedRefusals(SPEICHERN)) {
      for (const status of [409, 422]) {
        stand.ablehnung = refusedOn(SPEICHERN, code, status);
        const answer = await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } });
        expect(answer, `${code} at ${String(status)} reaches the admin as the unexpected failure`).not.toEqual({ ok: false });
      }
    }
  });

  it("sends a fixture deleted since the read to reload the page", async () => {
    stand.ablehnung = refusedOn(SPEICHERN, "DB-COMMON-001");

    expect(await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } })).toEqual({
      ok: false,
      reason: COPY.shared.fehler.veraltet,
    });
  });

  it("sends a session the guard found ended to sign in again, writing nothing", async () => {
    stand.abgewiesen = "signIn";

    expect(await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } })).toEqual({
      ok: false,
      reason: COPY.shared.fehler.abgelaufen,
    });
    expect(stand.gesendet).toEqual([]);
  });

  it("answers a grant the guard found gone as the unexpected failure, which no sign-in repairs", async () => {
    stand.abgewiesen = "grantGone";

    expect(await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } })).toEqual({ ok: false });
  });

  it("sends a save nobody can tell landed to reload the page, never to press again", async () => {
    stand.unklar = true;

    expect(await spielSpeichern({ id: SPIEL_ID, fingerprint: FINGERPRINT, changes: { uhrzeit: "18:00:00" } })).toEqual({
      ok: false,
      reason: COPY.shared.fehler.veraltet,
    });
  });
});
