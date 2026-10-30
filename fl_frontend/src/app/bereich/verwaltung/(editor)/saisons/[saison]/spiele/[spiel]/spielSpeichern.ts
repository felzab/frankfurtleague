"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielePatchSpiel } from "@/core/generated/client/sdk";
import { SpielePatchSpielBody, SpielePatchSpielParams } from "@/core/generated/zod/inputs";
import { admitsShootOut } from "@/features/spiele/draftStatus";
import { getAdminSpiel } from "@/features/spiele/queries";
import { describeMovedSpiele, toStoredSide } from "@/features/spiele/utils";

import { KEIN_SONDEREREIGNIS, werteOf } from "./spielWerte";

import type { FLPatchSpielDataPayload, FLSonderereignis, FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { ActionAnswer } from "@/kit/useFormAction";

const { shape } = SpielePatchSpielBody;
const [ortShape] = shape.ort.options;
// The write's version as a number alone: the editor's save always sends the one it read.
const [versionShape] = shape.version.unwrap().options;

/** A price box's text: empty is no price, digits alone a figure, anything else stays text the price refuses. */
const preis = z.preprocess(
  (wert) => (wert === "" ? null : typeof wert === "string" && /^\d+$/.test(wert) ? Number(wert) : wert),
  z.union([ortShape.shape.mietpreis, z.null()]),
);

/** What the editor's boxes send, each held to the match write's own published rule for it. */
const SpielSpeichern = z.object({
  id: SpielePatchSpielParams.shape.spiel_id,
  // The fixture's version as the editor read it, which the editor holds as text.
  fingerprint: z.preprocess((wert) => (typeof wert === "string" && /^\d+$/.test(wert) ? Number(wert) : wert), versionShape),
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
const gespeicherterPreis = (spiel: FLSpielJoinedAdmin) => spiel.ort?.mietpreis ?? null;

/**
 * The fixture as it stands with the editor's changes over it. Today's write replaces the whole fixture, so
 * every field the editor does not show is sent as it is stored: the sides, their sources and the referee.
 */
function payloadOf(gespeichert: FLSpielJoinedAdmin, changes: Aenderungen): FLPatchSpielDataPayload | ActionAnswer<never> {
  const werte = werteOf(gespeichert);
  const spielort = changes.spielort === undefined ? werte.spielort : changes.spielort;
  const mietpreis = changes.mietpreis === undefined ? gespeicherterPreis(gespeichert) : changes.mietpreis;
  // The price is required while a venue is chosen.
  if (spielort !== null && mietpreis === null) return { ok: false, fieldErrors: { "changes.mietpreis": COPY.shared.feld.pflichtfeld } };

  const sonderereignis = changes.sonderereignis === undefined ? gespeichert.sonderereignis : changes.sonderereignis;
  // A no-show's goals are the award the write composed, never a score anyone played: taken back, the award
  // goes with it, else the write keeps the goals as a played result. Cleared, they also meet the rule that an
  // event leaving the match unscored carries no goals.
  const awardTakenBack = isNichtantreten(gespeichert.sonderereignis) && !isNichtantreten(sonderereignis);
  const sideOf = (stored: FLSpielJoinedAdmin["team1"]) => {
    const side = toStoredSide(stored);
    return side === null ? null : { ...side, tore: awardTakenBack ? null : side.tore };
  };
  const team1 = sideOf(gespeichert.team1);
  const team2 = sideOf(gespeichert.team2);

  return {
    datum: changes.datum === undefined ? werte.datum : changes.datum,
    uhrzeit: changes.uhrzeit === undefined ? werte.uhrzeit : changes.uhrzeit,
    ort: spielort === null || mietpreis === null ? null : { spielort_id: spielort, mietpreis },
    // The booking alone: the write takes no display copy of the referee's name.
    schiedsrichter:
      gespeichert.schiedsrichter === null
        ? null
        : { schiedsrichter_id: gespeichert.schiedsrichter.schiedsrichter_id, payment: gespeichert.schiedsrichter.payment },
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
 * Saves the match editor's changes, answering the fixture's new version, which the editor takes as its own. The
 * version sent is the one the editor was read at: where the fixture has changed since, the write refuses the save
 * as stale (`version_stale`) rather than writing over it, in the one update that stores it.
 */
export const spielSpeichern = action({
  lane: "admin",
  name: "spielSpeichern",
  input: SpielSpeichern,
  ownWords: {
    spiel_outside_spieltag: "changes.datum",
    state_ergebnis_on_a_non_event: "changes.sonderereignis",
    state_nichtantreten_without_two_sides: "changes.sonderereignis",
    booking_unknown_resource: true,
    booking_unconfirmed_schiedsrichter: true,
    spiel_double_booked: true,
    ergebnis_side_emptied: true,
    spieltag_occupied: true,
    spieltag_occupied_by_the_resolution: true,
    eligibility_disqualified: true,
    eligibility_team_not_in_saison: true,
  },
  examples: { "changes.mietpreis": COPY.verwaltung.spielort.mietpreisBeispiel },
  run: async ({ id, fingerprint, changes }): Promise<ActionAnswer<string>> => {
    // Read for the fields the editor does not show, which the wholesale write sends as stored.
    const gelesen = await getAdminSpiel(id);
    if (gelesen === null) return { ok: false, reason: COPY.shared.fehler.veraltet };

    const payload = payloadOf(gelesen.spiel, changes);
    if ("ok" in payload) return payload;

    const geschrieben = await spielePatchSpiel(id, { ...payload, version: fingerprint });

    // What the write did to other fixtures, a later round's occupant or result among them, in today's editor's words.
    const folgen = describeMovedSpiele(geschrieben.advanced_to, geschrieben.bracket_faults, geschrieben.released_sides);
    const value = String(geschrieben.version);
    return folgen === undefined ? { ok: true, value } : { ok: true, value, note: COPY.verwaltung.spiel.gespeichertMitFolgen(folgen) };
  },
});
