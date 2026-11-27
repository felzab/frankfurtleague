"use server";

import { z } from "zod";

import { action, fault, numberBox } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { saisonsPatchSaison } from "@/core/generated/client/sdk";
import { SaisonsPatchSaisonBody, SaisonsPatchSaisonParams } from "@/core/generated/zod/inputs";
import { getAdminSaison } from "@/features/saisons/queries";

import { requiredOf } from "./saisonValues";

import type { LaneAnswer } from "@/core/action";
import type { FLPatchSaisonPayload, FLSaisonAdmin } from "@/core/generated/client/types";

const { shape } = SaisonsPatchSaisonBody;
const rules = shape.rules.shape;
const [bewerbungShape] = shape.bewerbung.options;
const [registrierungShape] = shape.registrierung.options;

/**
 * A box's value as the editor holds it, held to the write's own rule, which decides what it takes: a cleared date the
 * season must hold, refused as required, or a choice outside the rule's closed set.
 */
const fromBox = <Box, Rule extends z.ZodType>(rule: Rule) => z.preprocess((value: Box) => value, rule);

/** A window's day: an empty box is no day. */
const day = <Stored extends z.ZodType>(stored: Stored) => z.union([stored, z.null()]);

const SaveSaison = z.object({
  id: SaisonsPatchSaisonParams.shape.saison_id,
  version: shape.version,
  // Each box under the path the write names its field by, one key holding its dots, so a refusal of that path lands on
  // its box by the builder's own rule; the two pauses are the screen's, the write holding each window's `open`.
  changes: z
    .object({
      start_date: fromBox<string | null, typeof shape.start_date>(shape.start_date),
      end_date: fromBox<string | null, typeof shape.end_date>(shape.end_date),
      "rules.win_points": numberBox(rules.win_points),
      "rules.draw_points": numberBox(rules.draw_points),
      "rules.loss_points": numberBox(rules.loss_points),
      "rules.tiebreak_order": fromBox<string, typeof rules.tiebreak_order>(rules.tiebreak_order),
      "rules.number_of_gruppen": numberBox(rules.number_of_gruppen),
      "rules.teams_per_gruppe": numberBox(rules.teams_per_gruppe),
      "rules.qualifiers_per_gruppe": numberBox(rules.qualifiers_per_gruppe),
      "rules.max_kader_size": numberBox(rules.max_kader_size),
      "rules.allowed_stufen": fromBox<readonly string[], typeof rules.allowed_stufen>(rules.allowed_stufen),
      "rules.forfeit_ergebnis.sieger_tore": numberBox(rules.forfeit_ergebnis.shape.sieger_tore),
      "rules.forfeit_ergebnis.verlierer_tore": numberBox(rules.forfeit_ergebnis.shape.verlierer_tore),
      "bewerbung.start": day(bewerbungShape.shape.start),
      "bewerbung.end": day(bewerbungShape.shape.end),
      bewerbungPaused: z.boolean(),
      "registrierung.end": day(registrierungShape.shape.end),
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
function payloadOf(saison: FLSaisonAdmin, changes: Changes): Omit<FLPatchSaisonPayload, "version"> | LaneAnswer<never> {
  const stored = saison.rules;
  const bewerbungStart = either(changes["bewerbung.start"], saison.bewerbung?.start ?? null);
  const bewerbungEnd = either(changes["bewerbung.end"], saison.bewerbung?.end ?? null);
  const required = requiredOf({ "bewerbung.start": bewerbungStart, "bewerbung.end": bewerbungEnd });
  if (required.length > 0) return { ok: false, faults: required.map((box) => fault(`changes.${box}`, "required")) };
  // `open` is the form's own flag and the link's, which each box sets as its pause.
  const bewerbungPaused = either(changes.bewerbungPaused, saison.bewerbung?.open === false);
  const registrierungEnd = either(changes["registrierung.end"], saison.registrierung?.end ?? null);
  const registrierungPaused = either(changes.registrierungPaused, saison.registrierung?.open === false);

  return {
    start_date: either(changes.start_date, saison.start_date),
    end_date: either(changes.end_date, saison.end_date),
    rules: {
      win_points: either(changes["rules.win_points"], stored.win_points),
      draw_points: either(changes["rules.draw_points"], stored.draw_points),
      loss_points: either(changes["rules.loss_points"], stored.loss_points),
      tiebreak_order: either(changes["rules.tiebreak_order"], stored.tiebreak_order),
      number_of_gruppen: either(changes["rules.number_of_gruppen"], stored.number_of_gruppen),
      teams_per_gruppe: either(changes["rules.teams_per_gruppe"], stored.teams_per_gruppe),
      qualifiers_per_gruppe: either(changes["rules.qualifiers_per_gruppe"], stored.qualifiers_per_gruppe),
      max_kader_size: either(changes["rules.max_kader_size"], stored.max_kader_size),
      allowed_stufen: either(changes["rules.allowed_stufen"], stored.allowed_stufen),
      forfeit_ergebnis: {
        sieger_tore: either(changes["rules.forfeit_ergebnis.sieger_tore"], stored.forfeit_ergebnis.sieger_tore),
        verlierer_tore: either(changes["rules.forfeit_ergebnis.verlierer_tore"], stored.forfeit_ergebnis.verlierer_tore),
      },
    },
    bewerbung: bewerbungStart === null || bewerbungEnd === null ? null : { open: !bewerbungPaused, start: bewerbungStart, end: bewerbungEnd },
    registrierung: registrierungEnd === null ? null : { end: registrierungEnd, open: !registrierungPaused },
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
  examples: {
    "changes.rules.win_points": COPY.shared.field.exampleDigits,
    "changes.rules.draw_points": COPY.shared.field.exampleDigits,
    "changes.rules.loss_points": COPY.shared.field.exampleDigits,
    "changes.rules.number_of_gruppen": COPY.shared.field.exampleDigits,
    "changes.rules.teams_per_gruppe": COPY.shared.field.exampleDigits,
    "changes.rules.qualifiers_per_gruppe": COPY.shared.field.exampleDigits,
    "changes.rules.max_kader_size": COPY.shared.field.exampleDigits,
    "changes.rules.forfeit_ergebnis.sieger_tore": COPY.shared.field.exampleDigits,
    "changes.rules.forfeit_ergebnis.verlierer_tore": COPY.shared.field.exampleDigits,
  },
  run: async ({ id, version, changes }): Promise<LaneAnswer<number>> => {
    // Read for the fields the editor did not change, which the wholesale write sends as stored.
    const read = await getAdminSaison(id);
    if (read === null) return { ok: false, reason: COPY.shared.failure.stale };

    const payload = payloadOf(read.saison, changes);
    if ("ok" in payload) return payload;

    const { version: stored } = await saisonsPatchSaison(id, { ...payload, version });
    return { ok: true, value: stored };
  },
});
