import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLGruppenNamesSchema, FLSaisonTeamKontakteSchema, FLSchulformSchema, FLTrikotFarbeSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, FLAddressSchema } from "@/shared/schemas";

import { BEWERBUNG_GRUND_MAX_LENGTH } from "./constants";

/**
 * Mirrors `FLBewerbungStatus`. `eingereicht` is the only state a submission arrives in; the other two
 * are the triage's, and the two triage endpoints are the only writers of either.
 */
export const FLBewerbungStatusSchema = z.enum(["eingereicht", "angenommen", "abgelehnt"]);
export type FLBewerbungStatus = z.infer<typeof FLBewerbungStatusSchema>;

/**
 * Mirrors `FLBewerbungSchule` — the club a new school proposes, in the shape acceptance creates it in.
 * Null on an application that picked an existing club.
 */
export const FLBewerbungSchuleSchema = z.object({
  // The club's SHORT name beside `full_name`, not the school's own — the backend model says why it
  // is spelled `team_name` inside a block called `schule`.
  team_name: z.string().nonempty(),
  full_name: z.string().nonempty(),
  shorthand: z.string(),
  schulform: FLSchulformSchema.nullable(),
  address: FLAddressSchema,
  // A plain string, never `ExternalUrlSchema`: the API serves a stored value unchecked, and
  // refusing one on read fails the whole list over the row an administrator needs in order to decline it.
  website_url: z.string(),
});
export type FLBewerbungSchule = z.infer<typeof FLBewerbungSchuleSchema>;

/**
 * Mirrors `FLBewerbungTrikot` — what the school already owns, and the colour it would like. Never
 * copied onto the team: the assignment is the administrator's, and two schools may wish for one colour.
 */
export const FLBewerbungTrikotSchema = z.object({
  vorhandener_satz: z.string(),
  wunschfarbe: FLTrikotFarbeSchema.nullable(),
});
export type FLBewerbungTrikot = z.infer<typeof FLBewerbungTrikotSchema>;

/**
 * Mirrors `FLBewerbungKader` — the school's own estimate of its squad. Unbounded on read, as every
 * read field here is: a stored value outside a bound must still parse, or one row fails a whole list.
 */
export const FLBewerbungKaderSchema = z.object({
  voraussichtliche_groesse: z.int(),
  gute_spieler: z.int().nullable(),
});
export type FLBewerbungKader = z.infer<typeof FLBewerbungKaderSchema>;

/** Mirrors `FLBewerbungEntscheidung` — who decided, when, and on a decline why. */
export const FLBewerbungEntscheidungSchema = z.object({
  getroffen_am: CustomDateStringSchema,
  von: z.string(),
  // Null on an acceptance: what an acceptance did is the club and the junction row it wrote.
  grund: z.string().nullable(),
});
export type FLBewerbungEntscheidung = z.infer<typeof FLBewerbungEntscheidungSchema>;

/**
 * Mirrors `FLBewerbung` — one school's application to play one season, as it is stored. The submission
 * is never rewritten: only `status`, `entscheidung` and `team_id` move, through the two triage endpoints.
 */
export const FLBewerbungSchema = z.object({
  id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  eingereicht_am: CustomDateStringSchema,
  status: FLBewerbungStatusSchema,
  // The club the applicant PICKED, null where they proposed a new school. Acceptance writes the
  // created club's id back here, so a decided application always names one.
  team_id: CustomObjectIdStringSchema.nullable(),
  schule: FLBewerbungSchuleSchema.nullable(),
  // The junction's own three seats, imported rather than restated: an application's three people
  // BECOME the junction's three at acceptance, which is how the backend declares it too.
  kontakte: FLSaisonTeamKontakteSchema,
  trikot: FLBewerbungTrikotSchema,
  kader: FLBewerbungKaderSchema,
  entscheidung: FLBewerbungEntscheidungSchema.nullable(),
});
export type FLBewerbung = z.infer<typeof FLBewerbungSchema>;

/**
 * Mirrors `FLAnnehmenBewerbungPayload`. No `saison_id`: the application names its own season, so a
 * payload carrying one could only disagree with it.
 */
export const FLAnnehmenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  // Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment.
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});
export type FLAnnehmenBewerbungPayload = z.infer<typeof FLAnnehmenBewerbungPayloadSchema>;

/**
 * Mirrors `FLAblehnenBewerbungPayload`. Its own declaration and never shared with the acceptance's:
 * the two are not inverses, and a payload reaching both would let a value typed for one arrive at
 * the other.
 */
export const FLAblehnenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Required and non-empty: it is stored on the application AND sent to the people who applied, so a
  // decline with nothing to say is one nobody can act on. German because the panel binds it to its input.
  grund: z
    .string()
    // Trimmed before it is measured, and the trimmed value is what the write carries: „   “ is an
    // empty reason, and a decline is stored and mailed once with no way back.
    .trim()
    .nonempty({ error: "Bitte gib einen Grund für die Absage an." })
    .max(BEWERBUNG_GRUND_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen lang sein.` }),
});
export type FLAblehnenBewerbungPayload = z.infer<typeof FLAblehnenBewerbungPayloadSchema>;

export const FLBewerbungenListResponseSchema = BaseAPIResponseSchema.extend({
  bewerbungen: z.array(FLBewerbungSchema),
});
export type FLBewerbungenListResponse = z.infer<typeof FLBewerbungenListResponseSchema>;

export const FLBewerbungSingleResponseSchema = BaseAPIResponseSchema.extend({
  bewerbung: FLBewerbungSchema,
});
export type FLBewerbungSingleResponse = z.infer<typeof FLBewerbungSingleResponseSchema>;

/** Mirrors `FLAnnehmenBewerbungResponse` — the application as the acceptance left it, plus what it wrote beyond it. */
export const FLAnnehmenBewerbungResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLBewerbungSchema,
  // The club now standing in the season: the one the applicant picked, or the one this acceptance
  // created. Echoed because a created club has an id the caller has no other way to learn.
  team_id: CustomObjectIdStringSchema,
  // Whether this acceptance created that club. Comparing the application's own `team_id` cannot tell
  // the two apart — acceptance writes the created id back onto it.
  created_team: z.boolean(),
  saison_id: z.string(),
  gruppe: FLGruppenNamesSchema,
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});
export type FLAnnehmenBewerbungResponse = z.infer<typeof FLAnnehmenBewerbungResponseSchema>;

export const FLAblehnenBewerbungResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLBewerbungSchema,
});
export type FLAblehnenBewerbungResponse = z.infer<typeof FLAblehnenBewerbungResponseSchema>;
