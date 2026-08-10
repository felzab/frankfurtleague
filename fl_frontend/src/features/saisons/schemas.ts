/**
 * SAISONS · models
 *
 * Mirrors `fl_backend/app/api/saisons/schemas.py`.
 *
 * `FLSaisonPhaseSchema` lives here rather than in `spiele` because a phase is a property of the
 * season's structure; `spiele` and `spieltage` both import it, so there is one definition and the
 * three cannot drift.
 *
 * Note `"playoffs"` is NOT in the phase enum — it is a query-only alias the backend compiles to
 * "not gruppenphase", and it never appears on a document.
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLSpielerStufeSchema } from "@/features/spieler/schemas";
import { CustomDateStringSchema } from "@/shared/schemas";

export const FLSaisonStatusSchema = z.enum(["past", "active", "future"], { error: "FLSaisonStatus is invalid" });
export type FLSaisonStatus = z.infer<typeof FLSaisonStatusSchema>;
export const FLSaisonPhaseSchema = z.enum(["gruppenphase", "achtelfinale", "viertelfinale", "halbfinale", "finale"], {
  error: "FLSaisonPhase is invalid",
});

/**
 * How many teams a season may send into the bracket: `2 ** (knockout rounds)`.
 *
 * Mirrors `MAX_QUALIFIERS` in `fl_backend/app/api/spiele/schemas.py`, and derived from the same STRUCTURE
 * rather than copied as a number -- the knockout rounds are every phase but the group phase, so adding a
 * round of 32 to the enum above raises this at both ends at once (ADR-0052). A hardcoded 16 would compile,
 * pass, and refuse the seasons the new round was added for.
 *
 * Read off the schema's own members rather than `SAISON_PHASE_OPTIONS`, which would make this module import
 * `constants.ts` while that one imports this file's `FLSaisonPhase` type -- a cycle for no gain. The COUNT
 * is a property of the closed set, which is this file's; the ORDER is the constant's.
 */
export const MAX_QUALIFIERS = 2 ** (FLSaisonPhaseSchema.options.length - 1);
export type FLSaisonPhase = z.infer<typeof FLSaisonPhaseSchema>;

/**
 * The season's competition rules.
 *
 * **The messages are German because the season editor binds this schema.** Every field here is a
 * control on `/admin/saisons/[saison_id]`, judged in the browser with the same schema the action
 * parses (ADR-0040), so a bound that fails has to say why in the language of the surface. The
 * apiContract suite compares the wire contract and deliberately not the messages (ADR-0033), so
 * these are the frontend's alone.
 */
export const FLSaisonRulesSchema = z.object({
  win_points: z.int().positive({ error: "Ein Sieg bringt mindestens 1 Punkt." }),
  draw_points: z.int().nonnegative({ error: "Ein Unentschieden bringt 0 oder mehr Punkte." }),
  // How many of each group's teams reach the first knockout round (ADR-0035). Required, with no
  // default on either side: a season that has never carried it must fail loudly rather than seed a
  // bracket from a number nobody chose.
  qualifiers_per_group: z.int().positive({ error: "Mindestens 1 Team pro Gruppe muss weiterkommen." }),
  // The season's capacity: it runs the first `number_of_groups` of the closed A-D set -- the
  // `.max(4)` -- and each group takes `teams_per_group` rows. Required, like the line above, and the
  // junction write refuses an entry outside these bounds.
  number_of_groups: z.int().positive({ error: "Eine Saison braucht mindestens 1 Gruppe." }).max(4, { error: "Es gibt höchstens 4 Gruppen." }),
  teams_per_group: z.int().positive({ error: "Eine Gruppe nimmt mindestens 1 Team auf." }),
  // Which school levels this season's squads may hold: a SUBSET of the league's closed set
  // (ADR-0048), so a season picks from the vocabulary rather than redefining it, and never empty --
  // a season offering no level makes every squad entry unfillable.
  erlaubte_stufen: z.array(FLSpielerStufeSchema).min(1, { error: "Wähle mindestens eine Stufe aus." }),
});
export type FLSaisonRules = z.infer<typeof FLSaisonRulesSchema>;

/**
 * One phase the season plays: how many matchdays it takes, and how many matches each of those holds.
 *
 * **Mirrored rather than recomputed here** (ADR-0052). The arithmetic has a case a hand-written copy gets
 * wrong — a group with an odd number of teams needs an extra round, because one team sits out each round
 * — and a copy that undercounts REFUSES a phase the endpoint accepts. The backend derives it from the
 * season's `rules` and serves it, so there is one answer.
 *
 * A phase this season's bracket does not reach is ABSENT rather than present with zeroes, so this list is
 * the phases the season actually plays, in playing order.
 */
export const FLSaisonPhaseScheduleSchema = z.object({
  phase: FLSaisonPhaseSchema,
  matchdays: z.int().nonnegative(),
  matches_per_matchday: z.int().nonnegative(),
});
export type FLSaisonPhaseSchedule = z.infer<typeof FLSaisonPhaseScheduleSchema>;

export const FLSaisonSchema = z.object({
  // Exactly 4, mirroring the backend's `FLSaison.id`, as every `saison_id` schema does.
  // `resolveSaisonId` validates `?saison_id=` against this list (ADR-0055), so an unbounded id lets
  // the selector offer a season the backend cannot hold.
  id: z.string().length(4),

  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  status: FLSaisonStatusSchema,
  rules: FLSaisonRulesSchema,
  // Derived from `rules` and stored on no document (ADR-0052), the same way a matchday's
  // `anzahl_spiele` is -- this is the whole season, one entry per phase it plays.
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
 * `status` is on NO payload below, and that is the load-bearing absence (ADR-0026):
 * `POST /saisons/{saison_id}/activate` is the only code path in the system that writes it, and it
 * demotes the incumbent in the same transaction. A create always lands `future`.
 *
 * German messages throughout, because these schemas bind the admin form's inputs directly and the
 * browser renders whichever one a value fails.
 */
/**
 * The two rules the SEASON'S RULES have to satisfy on their own, mirroring `find_rules_refusal`'s first
 * two checks (`REQ-RULES-007` and `REQ-RULES-001`, ADR-0052).
 *
 * **Here rather than only at the endpoint because the page holds everything they need** -- both are pure
 * arithmetic over two fields of this payload, so refusing in the browser costs nothing and the admin never
 * sends a request that cannot succeed. The other five rules read the season's teams, its bracket wiring or
 * its matchdays, which this form does not have, so those stay the endpoint's and come back as a 409.
 *
 * The order matches the backend's: a group cannot qualify more teams than it holds is the narrower
 * statement, so it is checked before the bracket's shape.
 */
const groupCannotOverQualify = {
  error: "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.",
  path: ["rules", "qualifiers_per_group"],
};

const bracketMustHaveAShape = {
  error: `Gruppen mal Qualifizierte muss eine Zweierpotenz von 2 bis ${String(MAX_QUALIFIERS)} ergeben.`,
  path: ["rules", "qualifiers_per_group"],
};

/** `n` is a power of two, and `n & (n - 1)` is the standard test for it. Zero is not one. */
const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

const hasPlayableBracket = (rules: { number_of_groups: number; qualifiers_per_group: number }) => {
  const qualifiers = rules.number_of_groups * rules.qualifiers_per_group;

  return qualifiers >= 2 && qualifiers <= MAX_QUALIFIERS && isPowerOfTwo(qualifiers);
};

// Mirrors the model validator on both season payloads. The message goes on `end_date`, the field a
// person changes to fix it: react-aria renders a message under the input whose path it names.
const endsAfterItStarts = {
  error: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  path: ["end_date"],
};

export const FLPostSaisonPayloadSchema = z
  .object({
    // CHOSEN rather than generated, unlike every other create: `saisons._id` IS the string every
    // `saison_id` references, so a fifth character breaks every match and matchday pointing at this
    // season. Digits and a slash is what one looks like ("2526").
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
    // In the PATH on the wire; carried here because the editor has to know which season it is saving.
    id: z.string().length(4),

    start_date: CustomDateStringSchema,
    end_date: CustomDateStringSchema,
    rules: FLSaisonRulesSchema,
  })
  .refine((saison) => saison.end_date >= saison.start_date, endsAfterItStarts)
  .refine((saison) => saison.rules.qualifiers_per_group <= saison.rules.teams_per_group, groupCannotOverQualify)
  .refine((saison) => hasPlayableBracket(saison.rules), bracketMustHaveAShape);
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
