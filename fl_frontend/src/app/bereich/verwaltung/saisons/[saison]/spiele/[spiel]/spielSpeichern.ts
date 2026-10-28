"use server";

import { COPY } from "@/core/copy";
import { admitsShootOut } from "@/features/spiele/draftStatus";
import { patchAdminSpielData } from "@/features/spiele/mutations";
import { getAdminSpiel } from "@/features/spiele/queries";
import { FLPatchSpielDataPayloadSchema, FLSonderereignisSchema } from "@/features/spiele/schemas";
import { spielStateKey, toStoredSide } from "@/features/spiele/utils";
import { CustomObjectIdStringSchema } from "@/shared/schemas";
import { isRefusal } from "@/shared/utils/actionError";
import { invalidatesOnWrite, runAdminMutation } from "@/shared/utils/adminMutation";

import { werteOf } from "./spielLesen";
import { KEIN_SONDEREREIGNIS } from "./spielWerte";

import type { Copy } from "@/core/copy";
import type { FLSpielAdmin } from "@/features/spiele/schemas";
import type { EditorSave } from "@/kit/useEditor";
import type { ActionAnswer } from "@/kit/useFormAction";
import type { SpielFeld, SpielWerte } from "./spielWerte";

const ABGELEHNT = COPY.verwaltung.spiel.abgelehnt;

/**
 * The match write's refusals, by the rule the backend names: on the field that caused it where the editor
 * shows that field, else as the status line's reason. A rule left out answers as the unexpected failure.
 */
const ABLEHNUNGEN: Readonly<Record<string, { feld?: SpielFeld; text: Copy }>> = {
  "REQ-DATE-001": { feld: "datum", text: ABGELEHNT.datumAusserhalb },
  "REQ-BOOKING-001": { text: ABGELEHNT.stillgelegt },
  "REQ-BOOKING-002": { text: ABGELEHNT.unbestaetigt },
  // The referee booked when the editor was read has changed since: the fingerprint's refusal.
  "REQ-BOOKING-003": { text: COPY.shared.fehler.veraltet },
  "REQ-CLASH-001": { text: ABGELEHNT.zeitgleich },
  "REQ-RESULT-001": { text: ABGELEHNT.teamMitErgebnis },
  "REQ-SPIELTAG-001": { text: ABGELEHNT.schonAmSpieltag },
  "REQ-SPIELTAG-002": { text: ABGELEHNT.doppeltAmSpieltag },
  "REQ-ELIGIBILITY-001": { text: ABGELEHNT.ausgeschieden },
  "REQ-ELIGIBILITY-002": { text: ABGELEHNT.nichtInSaison },
  "REQ-STATE-002": { feld: "sonderereignis", text: ABGELEHNT.ohneWertung },
  "REQ-STATE-003": { feld: "sonderereignis", text: ABGELEHNT.beideTeamsNoetig },
};

type Antwort = { success: true } | { success: false; antwort: ActionAnswer };

const abgelehnt = (antwort: ActionAnswer): Antwort => ({ success: false, antwort });

/**
 * The fixture as it stands with the editor's changes over it. Today's write replaces the whole fixture, so
 * every field the editor does not show is sent as it is stored: the sides, their sources and the referee.
 */
function payloadOf(gespeichert: FLSpielAdmin, changes: Partial<SpielWerte>): { payload: unknown } | { antwort: ActionAnswer } {
  const werte = { ...werteOf(gespeichert), ...changes };

  // Digits alone make a price; the field is required while a venue is chosen.
  const mietpreis = werte.mietpreis.trim();
  if (werte.spielort !== null && !/^\d+$/.test(mietpreis)) {
    return { antwort: { ok: false, fieldErrors: { mietpreis: COPY.shared.feld.format(COPY.verwaltung.spielort.mietpreisBeispiel) } } };
  }

  const sonderereignis = werte.sonderereignis === KEIN_SONDEREREIGNIS ? null : FLSonderereignisSchema.parse(werte.sonderereignis);
  const team1 = toStoredSide(gespeichert.team1);
  const team2 = toStoredSide(gespeichert.team2);

  return {
    payload: {
      spiel_id: gespeichert.id,
      datum: werte.datum,
      uhrzeit: werte.uhrzeit,
      ort: werte.spielort === null ? null : { spielort_id: werte.spielort, mietpreis: Number(mietpreis) },
      schiedsrichter: gespeichert.schiedsrichter,
      team1: team1 === null ? null : { team_id: team1.team_id, tore: team1.tore },
      team2: team2 === null ? null : { team_id: team2.team_id, tore: team2.tore },
      team1_quelle: gespeichert.team1_quelle,
      team2_quelle: gespeichert.team2_quelle,
      // A shoot-out stands only where the fixture still admits one; every route out of one drops it, as today's editor does.
      elfmeterschiessen: admitsShootOut(gespeichert.saison_phase, team1, team2, sonderereignis) ? gespeichert.elfmeterschiessen : null,
      sonderereignis,
      notiz: werte.notiz,
      // The referee the editor was served: the write refuses the save where the fixture books another or none since.
      schiedsrichter_stand: gespeichert.schiedsrichter?.schiedsrichter_id ?? null,
    },
  };
}

/**
 * Saves the match editor's changes. The fingerprint is the stored fixture the editor was read from: where
 * the fixture has changed since, the save is refused as stale rather than writing over it. Otherwise the
 * changes go over the fixture as it stands, through today's match write, its guard, its cache tags and its
 * refusals.
 */
export async function spielSpeichern(change: EditorSave<SpielWerte>): Promise<ActionAnswer> {
  const id = CustomObjectIdStringSchema.safeParse(change.id);
  if (!id.success) return { ok: false };

  const result = await runAdminMutation("spielSpeichern", async (): Promise<Antwort> => {
    // The tags every match list carries, declared ahead of the read; the season's own follow once it names the season.
    invalidatesOnWrite("spiele", "teams");
    const gelesen = await getAdminSpiel(id.data);
    if (gelesen === null || spielStateKey(gelesen.spiel) !== change.fingerprint) {
      return abgelehnt({ ok: false, reason: COPY.shared.fehler.veraltet });
    }

    const gebaut = payloadOf(gelesen.spiel, change.changes);
    if ("antwort" in gebaut) return abgelehnt(gebaut.antwort);
    // The fields the editor cannot produce wrongly: a failure here is unexpected.
    const payload = FLPatchSpielDataPayloadSchema.safeParse(gebaut.payload);
    if (!payload.success) return abgelehnt({ ok: false });

    const saison = gelesen.spiel.saison_id;
    invalidatesOnWrite(`spiele:saison_id:${saison}`, `teams:saison_id:${saison}`);
    try {
      const geschrieben = await patchAdminSpielData(payload.data, null);
      return geschrieben.acknowledged ? { success: true } : abgelehnt({ ok: false });
    } catch (error) {
      if (!isRefusal(error)) throw error;
      const ablehnung = error.serverErrorCode === undefined ? undefined : ABLEHNUNGEN[error.serverErrorCode];
      if (ablehnung === undefined) return abgelehnt({ ok: false });
      return abgelehnt(
        ablehnung.feld === undefined ? { ok: false, reason: ablehnung.text } : { ok: false, fieldErrors: { [ablehnung.feld]: ablehnung.text } },
      );
    }
  });

  if (result.success) return { ok: true, value: undefined };
  // The guard's own refusals, a session ended among them, carry no words of the catalogue's: the unexpected failure.
  return "antwort" in result ? result.antwort : { ok: false };
}
