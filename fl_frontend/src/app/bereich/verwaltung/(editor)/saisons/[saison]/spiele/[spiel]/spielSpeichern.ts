"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielePatchSpielData } from "@/core/generated/client/sdk";
import { SpielePatchSpielDataBody, SpielePatchSpielDataParams } from "@/core/generated/zod/inputs";
import { admitsShootOut } from "@/features/spiele/draftStatus";
import { getAdminSpiel } from "@/features/spiele/queries";
import { describeMovedSpiele, spielStateKey, toStoredSide } from "@/features/spiele/utils";

import { KEIN_SONDEREREIGNIS, werteOf } from "./spielWerte";

import type { FLPatchSpielDataPayload } from "@/core/generated/client/types";
import type { FLSonderereignis, FLSpielAdmin } from "@/features/spiele/schemas";
import type { ActionAnswer } from "@/kit/useFormAction";

const { shape } = SpielePatchSpielDataBody;
const [ortShape] = shape.ort.options;

/** A price box's text: empty is no price, digits alone a figure, anything else stays text the price refuses. */
const preis = z.preprocess(
  (wert) => (wert === "" ? null : typeof wert === "string" && /^\d+$/.test(wert) ? Number(wert) : wert),
  z.union([ortShape.shape.mietpreis, z.null()]),
);

/** What the editor's boxes send, each held to the match write's own published rule for it. */
const SpielSpeichern = z.object({
  id: SpielePatchSpielDataParams.shape.spiel_id,
  fingerprint: z.string(),
  changes: z
    .object({
      datum: shape.datum,
      uhrzeit: shape.uhrzeit,
      spielort: z.union([ortShape.shape.spielort_id, z.null()]),
      mietpreis: preis,
      sonderereignis: z.preprocess((wert) => (wert === KEIN_SONDEREREIGNIS ? null : wert), shape.sonderereignis),
      notiz: shape.notiz,
    })
    .partial(),
});

type Aenderungen = z.output<typeof SpielSpeichern>["changes"];

const isNichtantreten = (sonderereignis: FLSonderereignis | null) =>
  sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2";

/** The stored price where the box was left alone: digits the stored figure is written in. */
const gespeicherterPreis = (spiel: FLSpielAdmin) => spiel.ort?.mietpreis ?? null;

/**
 * The fixture as it stands with the editor's changes over it. Today's write replaces the whole fixture, so
 * every field the editor does not show is sent as it is stored: the sides, their sources and the referee.
 */
function payloadOf(gespeichert: FLSpielAdmin, changes: Aenderungen): FLPatchSpielDataPayload | ActionAnswer<never> {
  const werte = werteOf(gespeichert);
  const spielort = changes.spielort === undefined ? werte.spielort : changes.spielort;
  const mietpreis = changes.mietpreis === undefined ? gespeicherterPreis(gespeichert) : changes.mietpreis;
  // The price is required while a venue is chosen.
  if (spielort !== null && mietpreis === null) return { ok: false, fieldErrors: { mietpreis: COPY.shared.feld.pflichtfeld } };

  const sonderereignis = changes.sonderereignis === undefined ? gespeichert.sonderereignis : changes.sonderereignis;
  // A no-show's goals are the award the write composed, never a score anyone played: taken back, the award
  // goes with it, else the write keeps the goals as a played result. Cleared, they also meet the rule that an
  // event leaving the match unscored carries no goals.
  const awardTakenBack = isNichtantreten(gespeichert.sonderereignis) && !isNichtantreten(sonderereignis);
  const sideOf = (stored: FLSpielAdmin["team1"]) => {
    const side = toStoredSide(stored);
    return side === null ? null : { ...side, tore: awardTakenBack ? null : side.tore };
  };
  const team1 = sideOf(gespeichert.team1);
  const team2 = sideOf(gespeichert.team2);

  return {
    datum: changes.datum === undefined ? werte.datum : changes.datum,
    uhrzeit: changes.uhrzeit === undefined ? werte.uhrzeit : changes.uhrzeit,
    ort: spielort === null || mietpreis === null ? null : { spielort_id: spielort, mietpreis },
    schiedsrichter: gespeichert.schiedsrichter,
    team1: team1 === null ? null : { team_id: team1.team_id, tore: team1.tore },
    team2: team2 === null ? null : { team_id: team2.team_id, tore: team2.tore },
    team1_quelle: gespeichert.team1_quelle,
    team2_quelle: gespeichert.team2_quelle,
    // A shoot-out stands only where the fixture still admits one; every route out of one drops it, as today's editor does.
    elfmeterschiessen: admitsShootOut(gespeichert.saison_phase, team1, team2, sonderereignis) ? gespeichert.elfmeterschiessen : null,
    sonderereignis,
    notiz: changes.notiz === undefined ? werte.notiz : changes.notiz,
    // The referee the editor was served: the write refuses the save where the fixture books another or none since.
    schiedsrichter_stand: gespeichert.schiedsrichter?.schiedsrichter_id ?? null,
  };
}

/**
 * Saves the match editor's changes, answering the fingerprint of the fixture as it now stands. The fingerprint
 * sent is the stored fixture the editor was read from: where the fixture has changed since, the save is refused
 * as stale rather than writing over it. Otherwise the changes go over the fixture as it stands.
 */
export const spielSpeichern = action({
  lane: "admin",
  name: "spielSpeichern",
  input: SpielSpeichern,
  ownWords: {
    "REQ-DATE-001": "datum",
    "REQ-STATE-002": "sonderereignis",
    "REQ-STATE-003": "sonderereignis",
    "REQ-BOOKING-001": true,
    "REQ-BOOKING-002": true,
    "REQ-CLASH-001": true,
    "REQ-RESULT-001": true,
    "REQ-SPIELTAG-001": true,
    "REQ-SPIELTAG-002": true,
    "REQ-ELIGIBILITY-001": true,
    "REQ-ELIGIBILITY-002": true,
  },
  examples: { mietpreis: COPY.verwaltung.spielort.mietpreisBeispiel },
  run: async ({ id, fingerprint, changes }): Promise<ActionAnswer<string>> => {
    const gelesen = await getAdminSpiel(id);
    if (gelesen === null || spielStateKey(gelesen.spiel) !== fingerprint) return { ok: false, reason: COPY.shared.fehler.veraltet };

    const payload = payloadOf(gelesen.spiel, changes);
    if ("ok" in payload) return payload;

    const geschrieben = await spielePatchSpielData(id, payload);
    // Read again for the fingerprint of what the write stored, which the editor takes as its own.
    const gespeichert = await getAdminSpiel(id);
    if (gespeichert === null) return { ok: false, reason: COPY.shared.fehler.veraltet };

    // What the write did to other fixtures, a later round's occupant or result among them, in today's editor's words.
    const folgen = describeMovedSpiele(geschrieben.advanced_to ?? [], geschrieben.bracket_faults ?? [], geschrieben.released_sides ?? []);
    const value = spielStateKey(gespeichert.spiel);
    return folgen === undefined ? { ok: true, value } : { ok: true, value, note: COPY.verwaltung.spiel.gespeichertMitFolgen(folgen) };
  },
});
