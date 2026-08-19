import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLSpielerStufeSchema } from "@/features/spieler/schemas";
// Acyclic: the teams slice's schemas import nothing but `@/shared`.
import { FLGruppenNamesSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

export const FLSaisonStatusSchema = z.enum(["past", "active", "future"], { error: "FLSaisonStatus is invalid" });
export type FLSaisonStatus = z.infer<typeof FLSaisonStatusSchema>;
// `"playoffs"` is deliberately absent: it is a query-only alias the backend compiles to "not
// gruppenphase", valid to send and never valid to receive.
export const FLSaisonPhaseSchema = z.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"], {
  error: "FLSaisonPhase is invalid",
});

/**
 * `2 ** (knockout rounds)`, mirroring `fl_backend/app/api/spiele/schemas.py :: MAX_QUALIFIERS`.
 * Derived so a new round raises it at both ends; off the schema rather than `SAISON_PHASE_OPTIONS`,
 * which would cycle via `constants.ts`.
 */
export const MAX_QUALIFIERS = 2 ** (FLSaisonPhaseSchema.options.length - 1);
export type FLSaisonPhase = z.infer<typeof FLSaisonPhaseSchema>;

/**
 * German messages: the season editor binds this schema directly and the browser renders whichever
 * bound fails. The apiContract suite compares the wire shape and deliberately not the messages.
 */
export const FLSaisonRulesSchema = z.object({
  win_points: z.int().positive({ error: "Ein Sieg bringt mindestens 1 Punkt." }),
  draw_points: z.int().nonnegative({ error: "Ein Unentschieden bringt 0 oder mehr Punkte." }),
  // Required on both sides: a season that never carried it must fail loudly rather than seed a
  // bracket from a number nobody chose.
  qualifiers_per_group: z.int().positive({ error: "Mindestens 1 Team pro Gruppe muss weiterkommen." }),
  // The season runs the first `number_of_groups` of the closed A-D set, hence the `.max(4)`.
  number_of_groups: z.int().positive({ error: "Eine Saison braucht mindestens 1 Gruppe." }).max(4, { error: "Es gibt höchstens 4 Gruppen." }),
  teams_per_group: z.int().positive({ error: "Eine Gruppe nimmt mindestens 1 Team auf." }),
  // A subset of the league's closed level set, never empty: no level makes every squad entry
  // unfillable.
  erlaubte_stufen: z.array(FLSpielerStufeSchema).min(1, { error: "Wähle mindestens eine Stufe aus." }),
});
export type FLSaisonRules = z.infer<typeof FLSaisonRulesSchema>;

/**
 * **Mirrored rather than recomputed**: an odd group needs an extra round because one team sits out,
 * and a copy that undercounts refuses a phase the endpoint accepts. A phase the bracket does not
 * reach is absent rather than zeroed.
 */
export const FLSaisonPhaseScheduleSchema = z.object({
  phase: FLSaisonPhaseSchema,
  matchdays: z.int().nonnegative(),
  matches_per_matchday: z.int().nonnegative(),
});
export type FLSaisonPhaseSchedule = z.infer<typeof FLSaisonPhaseScheduleSchema>;

export const FLSaisonSchema = z.object({
  // Exactly 4, mirroring the backend: an unbounded id lets `SaisonSelector` offer a season the
  // backend cannot hold.
  id: z.string().length(4),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  status: FLSaisonStatusSchema,
  rules: FLSaisonRulesSchema,
  // Derived from `rules`, stored on no document. One entry per phase the season plays.
  schedule: z.array(FLSaisonPhaseScheduleSchema),
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

/**
 * The two rules this payload can judge alone, mirroring `find_rules_refusal`'s first two checks in its
 * order (`REQ-RULES-007`, then `REQ-RULES-001`). The other five read data this form does not have.
 */
const groupCannotOverQualify = {
  error: "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.",
  path: ["rules", "qualifiers_per_group"],
};

const bracketMustHaveAShape = {
  error: `Gruppen mal Qualifizierte muss eine Zweierpotenz von 2 bis ${String(MAX_QUALIFIERS)} ergeben.`,
  path: ["rules", "qualifiers_per_group"],
};

/** Zero is not a power of two, hence the `n > 0`. */
const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

const hasPlayableBracket = (rules: { number_of_groups: number; qualifiers_per_group: number }) => {
  const qualifiers = rules.number_of_groups * rules.qualifiers_per_group;

  return qualifiers >= 2 && qualifiers <= MAX_QUALIFIERS && isPowerOfTwo(qualifiers);
};

// The message names `end_date`, the field to fix: react-aria renders it under the input its path names.
const endsAfterItStarts = {
  error: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  path: ["end_date"],
};

export const FLPostSaisonPayloadSchema = z
  .object({
    // Chosen rather than generated, unlike every other create: `saisons._id` IS the referenced string.
    id: z.string().length(4, { error: "Die Saison-ID besteht aus genau 4 Zeichen, z. B. 2526." }),

    start_date: CustomDateStringSchema,
    end_date: CustomDateStringSchema,
    rules: FLSaisonRulesSchema,
  })
  .refine((saison) => saison.end_date >= saison.start_date, endsAfterItStarts)
  .refine((saison) => saison.rules.qualifiers_per_group <= saison.rules.teams_per_group, groupCannotOverQualify)
  .refine((saison) => hasPlayableBracket(saison.rules), bracketMustHaveAShape);
export type FLPostSaisonPayload = z.infer<typeof FLPostSaisonPayloadSchema>;

export const FLPatchSaisonPayloadSchema = z
  .object({
    // In the PATH on the wire; here because the editor has to know which season it is saving.
    id: z.string().length(4),

    start_date: CustomDateStringSchema,
    end_date: CustomDateStringSchema,
    rules: FLSaisonRulesSchema,
  })
  .refine((saison) => saison.end_date >= saison.start_date, endsAfterItStarts)
  .refine((saison) => saison.rules.qualifiers_per_group <= saison.rules.teams_per_group, groupCannotOverQualify)
  .refine((saison) => hasPlayableBracket(saison.rules), bracketMustHaveAShape);
export type FLPatchSaisonPayload = z.infer<typeof FLPatchSaisonPayloadSchema>;

/** An id in the path and no request body. */
export const FLActivateSaisonPayloadSchema = z.object({
  id: z.string().length(4),
});
export type FLActivateSaisonPayload = z.infer<typeof FLActivateSaisonPayloadSchema>;

/**
 * **Neither side carries a group**: the backend reads the two junction rows inside the transaction, so
 * a form built against a season that has since moved cannot write a group nobody stands in.
 */
export const FLSwapGruppenPayloadSchema = z.object({
  saison_id: z.string().length(4),
  team1_id: CustomObjectIdStringSchema,
  team2_id: CustomObjectIdStringSchema,
});
export type FLSwapGruppenPayload = z.infer<typeof FLSwapGruppenPayloadSchema>;

export const FLPostSaisonResponseSchema = BaseAPIResponseSchema.extend({
  created_id: z.string(),
});
export type FLPostSaisonResponse = z.infer<typeof FLPostSaisonResponseSchema>;

export const FLPatchSaisonResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSaisonSchema,
});
export type FLPatchSaisonResponse = z.infer<typeof FLPatchSaisonResponseSchema>;

/** `deactivated` counts the seasons moved off `active`, and `activateSaisonAction` reports it. */
export const FLActivateSaisonResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSaisonSchema,
  deactivated: z.int().nonnegative(),
});
export type FLActivateSaisonResponse = z.infer<typeof FLActivateSaisonResponseSchema>;

/**
 * The groups are what LANDED rather than what was intended: the backend writes from this object, which
 * is what lets the toast name them.
 */
export const FLSwapGruppenResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string().length(4),
  team1_id: CustomObjectIdStringSchema,
  team1_gruppe: FLGruppenNamesSchema,
  team2_id: CustomObjectIdStringSchema,
  team2_gruppe: FLGruppenNamesSchema,
  rewritten_spiele: z.int().nonnegative(),
});
export type FLSwapGruppenResponse = z.infer<typeof FLSwapGruppenResponseSchema>;
