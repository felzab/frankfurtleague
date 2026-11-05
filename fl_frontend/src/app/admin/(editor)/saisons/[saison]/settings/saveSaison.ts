"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { saisonsPatchSaison } from "@/core/generated/client/sdk";
import { SaisonsPatchSaisonBody, SaisonsPatchSaisonParams } from "@/core/generated/zod/inputs";
import { getAdminSaison } from "@/features/saisons/queries";

import type { ActionAnswer } from "@/core/action";
import type { FLPatchSaisonPayload, FLSaisonAdmin } from "@/core/generated/client/types";

const { shape } = SaisonsPatchSaisonBody;
const rules = shape.rules.shape;
const [bewerbungShape] = shape.bewerbung.options;
const [registrierungShape] = shape.registrierung.options;

/** A count's box: digits alone make its figure; empty stays empty and anything else text, which the figure refuses. */
const count = <Figure extends z.ZodType>(figure: Figure) =>
  z.preprocess((value) => (value === "" ? null : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value), figure);

/**
 * A box's value as the editor holds it, held to the write's own rule, which decides what it takes: a cleared date the
 * season must hold, refused as required, or a choice outside the rule's closed set.
 */
const fromBox = <Box, Rule extends z.ZodType>(rule: Rule) => z.preprocess((value: Box) => value, rule);

/** A window's day: an empty box is no day. */
const day = <Stored extends z.ZodType>(stored: Stored) => z.union([stored, z.null()]);

/** What the editor's boxes send, each held to the season write's own published rule for it. */
const SaveSaison = z.object({
  id: SaisonsPatchSaisonParams.shape.saison_id,
  // The season's version as the editor read it.
  version: shape.version,
  changes: z
    .object({
      start: fromBox<string | null, typeof shape.start_date>(shape.start_date),
      end: fromBox<string | null, typeof shape.end_date>(shape.end_date),
      winPoints: count(rules.win_points),
      drawPoints: count(rules.draw_points),
      tiebreak: fromBox<string, typeof rules.tiebreak_order>(rules.tiebreak_order),
      gruppen: count(rules.number_of_gruppen),
      teamsPerGruppe: count(rules.teams_per_gruppe),
      qualifiers: count(rules.qualifiers_per_gruppe),
      maxKader: count(rules.max_kadergroesse),
      stufen: fromBox<readonly string[], typeof rules.allowed_stufen>(rules.allowed_stufen),
      forfeitWinner: count(rules.forfeit_ergebnis.shape.sieger_tore),
      forfeitLoser: count(rules.forfeit_ergebnis.shape.verlierer_tore),
      bewerbungStart: day(bewerbungShape.shape.start),
      bewerbungEnd: day(bewerbungShape.shape.end),
      registrierungEnd: day(registrierungShape.shape.end),
      registrierungPaused: z.boolean(),
    })
    .partial(),
});

type Changes = z.output<typeof SaveSaison>["changes"];

/** A change where the editor sent one, else the stored value: a cleared day is a change to none. */
const either = <T>(changed: T | undefined, stored: T): T => (changed === undefined ? stored : changed);

/**
 * The season as it stands with the editor's changes over it: the write replaces the whole season, so every field the
 * editor left alone is sent as it is stored. A window with neither day is none, and one with a single day lacks the
 * other.
 */
function payloadOf(saison: FLSaisonAdmin, changes: Changes): Omit<FLPatchSaisonPayload, "version"> | ActionAnswer<never> {
  const stored = saison.rules;
  const bewerbungStart = either(changes.bewerbungStart, saison.bewerbung?.start ?? null);
  const bewerbungEnd = either(changes.bewerbungEnd, saison.bewerbung?.end ?? null);
  if (bewerbungStart === null && bewerbungEnd !== null)
    return { ok: false, fieldErrors: { "changes.bewerbungStart": COPY.shared.field.required } };
  if (bewerbungStart !== null && bewerbungEnd === null)
    return { ok: false, fieldErrors: { "changes.bewerbungEnd": COPY.shared.field.required } };
  const registrierungEnd = either(changes.registrierungEnd, saison.registrierung?.end ?? null);
  // `offen` is the link's own flag, which the box sets as its pause.
  const paused = either(changes.registrierungPaused, saison.registrierung?.offen === false);

  return {
    start_date: either(changes.start, saison.start_date),
    end_date: either(changes.end, saison.end_date),
    rules: {
      win_points: either(changes.winPoints, stored.win_points),
      draw_points: either(changes.drawPoints, stored.draw_points),
      tiebreak_order: either(changes.tiebreak, stored.tiebreak_order),
      number_of_gruppen: either(changes.gruppen, stored.number_of_gruppen),
      teams_per_gruppe: either(changes.teamsPerGruppe, stored.teams_per_gruppe),
      qualifiers_per_gruppe: either(changes.qualifiers, stored.qualifiers_per_gruppe),
      max_kadergroesse: either(changes.maxKader, stored.max_kadergroesse),
      allowed_stufen: either(changes.stufen, stored.allowed_stufen),
      forfeit_ergebnis: {
        sieger_tore: either(changes.forfeitWinner, stored.forfeit_ergebnis.sieger_tore),
        verlierer_tore: either(changes.forfeitLoser, stored.forfeit_ergebnis.verlierer_tore),
      },
    },
    bewerbung: bewerbungStart === null || bewerbungEnd === null ? null : { start: bewerbungStart, end: bewerbungEnd },
    registrierung: registrierungEnd === null ? null : { end: registrierungEnd, offen: !paused },
  };
}

/**
 * Saves the season editor's changes, answering the season's new version, which the editor takes as its own. The
 * version sent is the one the editor was read at: where the season has changed since, a draw or a swap included, the
 * write refuses the save as stale rather than writing over it.
 */
export const saveSaison = action({
  lane: "admin",
  name: "saveSaison",
  input: SaveSaison,
  ownWords: [
    "saison_ends_before_start",
    "bewerbung_window_ends_before_start",
    "registrierung_window_reaches_saison_start",
    "saison_span_below_spieltage",
    "rules_qualifiers_above_gruppe",
    "rules_unentschieden_outvalues_win",
    "rules_forfeit_unentschieden_in_a_knockout",
    "rules_gruppen_in_use",
    "rules_capacity_below_use",
    "rules_kader_below_use",
    "rules_qualifiers_below_wiring",
    "rules_bracket_impossible",
    "rules_spiele_over_one_read",
  ],
  // The boxes a field pattern's phrase lands on, by the path the write names for each.
  paths: {
    start_date: "changes.start",
    end_date: "changes.end",
    "rules.win_points": "changes.winPoints",
    "rules.draw_points": "changes.drawPoints",
    "rules.number_of_gruppen": "changes.gruppen",
    "rules.teams_per_gruppe": "changes.teamsPerGruppe",
    "rules.qualifiers_per_gruppe": "changes.qualifiers",
    "rules.max_kadergroesse": "changes.maxKader",
    "rules.forfeit_ergebnis.sieger_tore": "changes.forfeitWinner",
    "rules.forfeit_ergebnis.verlierer_tore": "changes.forfeitLoser",
    "bewerbung.start": "changes.bewerbungStart",
    "bewerbung.end": "changes.bewerbungEnd",
    "registrierung.end": "changes.registrierungEnd",
  },
  examples: {
    "changes.winPoints": COPY.shared.field.exampleDigits,
    "changes.drawPoints": COPY.shared.field.exampleDigits,
    "changes.gruppen": COPY.shared.field.exampleDigits,
    "changes.teamsPerGruppe": COPY.shared.field.exampleDigits,
    "changes.qualifiers": COPY.shared.field.exampleDigits,
    "changes.maxKader": COPY.shared.field.exampleDigits,
    "changes.forfeitWinner": COPY.shared.field.exampleDigits,
    "changes.forfeitLoser": COPY.shared.field.exampleDigits,
  },
  run: async ({ id, version, changes }): Promise<ActionAnswer<number>> => {
    // Read for the fields the editor did not change, which the wholesale write sends as stored.
    const read = await getAdminSaison(id);
    if (read === null) return { ok: false, reason: COPY.shared.failure.stale };

    const payload = payloadOf(read.saison, changes);
    if ("ok" in payload) return payload;

    const saved = await saisonsPatchSaison(id, { ...payload, version });
    return { ok: true, value: saved.version };
  },
});
