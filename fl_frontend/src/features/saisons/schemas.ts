/**
 * SAISONS · models
 *
 * Mirrors `fl_backend/app/api/saisons/schemas.py`.
 *
 * `FLSaisonPhaseSchema` lives here rather than in `spiele` because a phase is a property of the
 * season's structure; `spiele` and `spieltage` both import it, so there is one definition and the
 * three cannot drift.
 *
 * Note the phase enum has exactly four values. `"playoffs"` is NOT one of them — it is a query-only
 * alias the backend compiles to "not gruppenphase", and it never appears on a document.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLSpielerStufeSchema } from "@/features/spieler/schemas";
import { CustomDateStringSchema } from "@/shared/schemas";

export const FLSaisonStatusSchema = z.enum(["past", "active", "future"], { error: "FLSaisonStatus is invalid" });
export type FLSaisonStatus = z.infer<typeof FLSaisonStatusSchema>;
export const FLSaisonPhaseSchema = z.enum(["gruppenphase", "viertelfinale", "halbfinale", "finale"], { error: "FLSaisonPhase is invalid" });
export type FLSaisonPhase = z.infer<typeof FLSaisonPhaseSchema>;

/**
 * The season's competition rules.
 *
 * **The messages are German because the season editor binds this schema.** Every field here is a
 * control on `/admin/saisons/[saison_id]`, judged in the browser with the same schema the action
 * parses (ADR-0050), so a bound that fails has to say why in the language of the surface. The
 * apiContract suite compares the wire contract and deliberately not the messages (ADR-0040), so
 * these are the frontend's alone.
 */
export const FLSaisonRulesSchema = z.object({
  win_points: z.int().positive({ error: "Ein Sieg bringt mindestens 1 Punkt." }),
  draw_points: z.int().nonnegative({ error: "Ein Unentschieden bringt 0 oder mehr Punkte." }),
  // How many of each group's teams reach the first knockout round (ADR-0043). Required, with no
  // default on either side: a season that has never carried it must fail loudly rather than seed a
  // bracket from a number nobody chose.
  qualifiers_per_group: z.int().positive({ error: "Mindestens 1 Team pro Gruppe muss weiterkommen." }),
  // The season's capacity (owner, 2026-08-07): it runs the first `number_of_groups` of the closed
  // A-D set — the `.max(4)` — and each group takes `teams_per_group` rows. Required for the same
  // reason as the line above; the junction write refuses an entry outside these bounds
  // (REQ-ENTER-001..003).
  number_of_groups: z.int().positive({ error: "Eine Saison braucht mindestens 1 Gruppe." }).max(4, { error: "Es gibt höchstens 4 Gruppen." }),
  teams_per_group: z.int().positive({ error: "Eine Gruppe nimmt mindestens 1 Team auf." }),
  // Which school levels this season's squads may hold (owner, 2026-08-07). A SUBSET of the league's
  // own closed set (ADR-0061) — the season picks from the vocabulary rather than redefining it — and
  // never empty, because a season offering no level makes every squad entry unfillable. Required
  // with no default, for the same reason the two above are.
  erlaubte_stufen: z.array(FLSpielerStufeSchema).min(1, { error: "Wähle mindestens eine Stufe aus." }),
});
export type FLSaisonRules = z.infer<typeof FLSaisonRulesSchema>;

export const FLSaisonSchema = z.object({
  // Exactly 4, mirroring the backend's FLSaison.id. FLSpielSchema.saison_id and
  // FLSpieltagSchema.saison_id both require .length(4), and resolveSaisonId silently discards a
  // param that is not 4 chars -- so an unbounded id here would let SaisonSelector offer a season
  // that renders as the current one with no error.
  id: z.string().length(4),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  status: FLSaisonStatusSchema,
  rules: FLSaisonRulesSchema,
});
export type FLSaison = z.infer<typeof FLSaisonSchema>;

export const FLSaisonsListResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("list"),
  saisons: z.array(FLSaisonSchema),
});
export type FLSaisonsListResponse = z.infer<typeof FLSaisonsListResponseSchema>;

export const FLSaisonsSingleResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("single"),
  saison: FLSaisonSchema,
});
export type FLSaisonsSingleResponse = z.infer<typeof FLSaisonsSingleResponseSchema>;

// ── The write path ───────────────────────────────────────────────────────────────────────────────────

/**
 * `status` is on NO payload below, and that is the load-bearing absence (ADR-0033):
 * `POST /saisons/{saison_id}/activate` is the only code path in the system that writes it, and it
 * demotes the incumbent in the same transaction. A create always lands `future`.
 *
 * German messages throughout, because these schemas bind the admin form's inputs directly and the
 * browser renders whichever one a value fails.
 */
export const FLPostSaisonPayloadSchema = z.object({
  // CHOSEN rather than generated, unlike every other create in the app: `saisons._id` IS the
  // four-character string every `saison_id` in the database references, so a fifth character breaks
  // every match and matchday that will point at this season. Digits and a slash is what a season id
  // looks like here ("2526"), and the length is what the backend enforces.
  id: z.string().length(4, { error: "Die Saison-ID besteht aus genau 4 Zeichen, z. B. 2526." }),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  rules: FLSaisonRulesSchema,
});
export type FLPostSaisonPayload = z.infer<typeof FLPostSaisonPayloadSchema>;

export const FLPatchSaisonPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the editor has to know which season it is saving.
  id: z.string().length(4),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  rules: FLSaisonRulesSchema,
});
export type FLPatchSaisonPayload = z.infer<typeof FLPatchSaisonPayloadSchema>;

/** The rollover's argument: an id in the path and no request body at all. */
export const FLActivateSaisonPayloadSchema = z.object({
  id: z.string().length(4),
});
export type FLActivateSaisonPayload = z.infer<typeof FLActivateSaisonPayloadSchema>;

export const FLPostSaisonResponseSchema = BaseAPIResponseSchema.extend({
  created_id: z.string(),
});
export type FLPostSaisonResponse = z.infer<typeof FLPostSaisonResponseSchema>;

export const FLPatchSaisonResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSaisonSchema,
});
export type FLPatchSaisonResponse = z.infer<typeof FLPatchSaisonResponseSchema>;

/**
 * The rollover's answer: the season now active, plus how many were moved off `active`.
 *
 * `deactivated` is normally exactly 1 and the editor reports it, because any other number is worth
 * seeing: 0 means this season already held `active`, and 2 or more means the database had drifted
 * into a state nothing can express and this call repaired it.
 */
export const FLActivateSaisonResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSaisonSchema,
  deactivated: z.int().nonnegative(),
});
export type FLActivateSaisonResponse = z.infer<typeof FLActivateSaisonResponseSchema>;
