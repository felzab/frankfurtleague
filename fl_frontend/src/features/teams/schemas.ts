import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import {
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  FLAddressSchema,
  KONTAKT_EMAIL_MAX_LENGTH,
  PersonNameSchema,
  PHONE_REGEX,
} from "@/shared/schemas";

import {
  DESCRIPTION_MAX_LENGTH,
  EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
  KONTAKT_NAME_MAX_LENGTH,
  TEAM_FULL_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_WEBSITE_URL_MAX_LENGTH,
} from "./constants";

/**
 * A club's website, or none. **`null` is the one spelling of absence and `""` is not admitted** —
 * the API always sends the key, coercing an empty box to null. Still `ExternalUrlSchema`: it lands
 * in an `href`, and `javascript:` parses as a URL.
 */
export const OptionalExternalUrlSchema = ExternalUrlSchema.nullable();

/**
 * Mirrors `FLGruppenNames` — a closed set, so a group outside it is a malformed response. German
 * error because the group picker binds this schema too, and an untouched picker submits null.
 */
export const FLGruppenNamesSchema = z.enum(["A", "B", "C", "D"], { error: "Bitte wähle eine Gruppe." });
export type FLGruppenNames = z.infer<typeof FLGruppenNamesSchema>;

/**
 * Mirrors `FLAustritt`. A team is out of a season exactly when `FLTeam.austritt` is not null, and
 * never a boolean beside it. `FLGruppenTeam.austritt_type` marks the same fact on the grouped row,
 * reusing this enum rather than adding an answer.
 */
export const FLAustrittSchema = z.object({
  // German error because the junction editor binds this schema to its inputs, and an untouched
  // picker submits null.
  type: z.enum(["disqualifikation", "rueckzug"], { error: "Bitte wähle, wie das Team ausgeschieden ist." }),
  // Free text written for publication: rendered as authored, never truncated to a label. German
  // because the junction editor binds this schema to its inputs.
  grund: z.string().nonempty({ error: "Bitte gib einen Grund an." }),
  datum: CustomDateStringSchema,
});
export type FLAustritt = z.infer<typeof FLAustrittSchema>;
export type FLAustrittType = FLAustritt["type"];

/**
 * Mirrors `FLSchulform`. No German error: the club editor offers `Keine Angabe` beside the six, so an
 * unanswered picker is a null the field accepts rather than a refusal.
 */
export const FLSchulformSchema = z.enum(
  [
    "gymnasium_g8",
    "gymnasium_g9",
    "gesamtschule",
    "privatschule_g8",
    "privatschule_g9",
    "oberstufengymnasium",
    // Named rather than enumerated: the picker is already showing the six, and Zod's own default
    // answers a person by listing the slugs the wire uses.
  ],
  { error: "Bitte wähle eine Schulform." },
);
export type FLSchulform = z.infer<typeof FLSchulformSchema>;

/**
 * Mirrors `FLTrikotFarbe` — the league's sixteen CI colours. The slug is what travels; its German name
 * and its swatch are `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`.
 */
export const FLTrikotFarbeSchema = z.enum(
  [
    "weiss",
    "schwarz",
    "rot",
    "braun",
    "orange",
    "gelb",
    "hellgruen",
    "gruen",
    "tuerkis",
    "hellblau",
    "blau",
    "dunkelblau",
    "violett",
    "magenta",
    "bordeaux",
    "grau",
    // Named rather than enumerated, for `FLSchulformSchema`'s reason: sixteen slugs is not an answer.
  ],
  { error: "Bitte wähle eine Trikotfarbe." },
);
export type FLTrikotFarbe = z.infer<typeof FLTrikotFarbeSchema>;

/**
 * Mirrors `FLKontaktEinwilligung` — what a contact person agreed to, and on whose word it is held.
 * The wider `umfang` is written by the person's own confirmation alone, so the payload below keeps
 * the one-member literal.
 */
export const FLKontaktEinwilligungSchema = z.object({
  umfang: z.enum(["kontaktdaten", "kontaktdaten_whatsapp"], { error: "Die Einwilligung gilt für Kontaktdaten, mit oder ohne WhatsApp." }),
  erteilt_von: z.enum(["person", "administrativ"]),
  // Unbounded on the read side, as every ceiling in this file is: a stored value over one of them
  // must still parse, or a single row fails a whole list.
  text_version: z.string(),
  datum: CustomDateStringSchema,
  // Null until the person has answered their own confirmation link. It is the one field separating
  // a consent the person gave from one the league recorded on their behalf.
  bestaetigt_am: CustomDateStringSchema.nullable(),
});
export type FLKontaktEinwilligung = z.infer<typeof FLKontaktEinwilligungSchema>;

/** Mirrors `FLKontaktEinwilligungPayload`. German throughout: the team editor binds it to its inputs. */
export const FLKontaktEinwilligungPayloadSchema = z.object({
  // Written by the form from `EINWILLIGUNG_UMFANG` rather than picked: one scope exists, so a control
  // offering it would ask a question with one answer.
  umfang: z.literal("kontaktdaten", { error: "Die Einwilligung gilt ausschließlich für Kontaktdaten." }),
  // No `erteilt_von` and no `bestaetigt_am`: both are the server's to compose, and a payload that
  // could name either would let an administrator record a consent as the person's own.
  text_version: z
    .string()
    .nonempty({ error: "Bitte gib an, welche Fassung unterschrieben wurde." })
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  datum: CustomDateStringSchema,
});
export type FLKontaktEinwilligungPayload = z.infer<typeof FLKontaktEinwilligungPayloadSchema>;

/**
 * Mirrors `FLKontaktperson`. Mailbox and number are shapeless here on purpose: `GET /teams/memberships`
 * is the only route to a bad row, so a value refused on read would lock itself in
 * (`docs/backend/spec.md :: I36`).
 */
export const FLKontaktpersonSchema = z.object({
  vorname: z.string().nonempty(),
  nachname: z.string().nonempty(),
  email: z.string(),
  telefon: z.string(),
  // Null until the person enters it on their confirmation page. Refused on read, one unconfirmed
  // seat would answer 500 for a whole triage list — `FLBewerbungSchule.website_url`'s failure.
  geburtsdatum: CustomDateStringSchema.nullable(),
  einwilligung: FLKontaktEinwilligungSchema,
});
export type FLKontaktperson = z.infer<typeof FLKontaktpersonSchema>;

/** One sentence for both name ceilings: the two boxes sit side by side and share the constant. */
const KONTAKT_NAME_ZU_LANG = `Der Name darf höchstens ${String(KONTAKT_NAME_MAX_LENGTH)} Zeichen lang sein.`;

/** Mirrors `FLKontaktpersonPayload`. German throughout: the team editor binds it to its inputs. */
export const FLKontaktpersonPayloadSchema = z.object({
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  // The ceiling is stated here rather than left to the address validator, whose refusal carries no
  // field detail, so nothing would mark the box.
  email: z
    .email({ error: "Bitte gib eine gültige E-Mail-Adresse ein." })
    .max(KONTAKT_EMAIL_MAX_LENGTH, { error: `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.` }),
  telefon: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  geburtsdatum: CustomDateStringSchema,
  einwilligung: FLKontaktEinwilligungPayloadSchema,
});
export type FLKontaktpersonPayload = z.infer<typeof FLKontaktpersonPayloadSchema>;

/**
 * Mirrors `FLTrainerZugleich` — which OTHER seat the Trainer also holds. One nullable field rather
 * than two flags, which would let a row claim both seats at once.
 */
export const FLTrainerZugleichSchema = z.enum(["ansprechperson", "stellvertretung"], {
  error: "Bitte wähle, wer zugleich Trainerin oder Trainer ist.",
});
export type FLTrainerZugleich = z.infer<typeof FLTrainerZugleichSchema>;

/**
 * Mirrors `FLSaisonTeamKontakte`. A seat is held in full even where `trainer_ist_zugleich` names it:
 * the field records the claim, and the stored copy is what a later edit is compared against.
 */
export const FLSaisonTeamKontakteSchema = z.object({
  // Nullable per SLOT, mirroring the stored shape: a person's erasure empties the slot naming them
  // and must not reach the two beside them.
  trainer: FLKontaktpersonSchema.nullable(),
  ansprechperson: FLKontaktpersonSchema.nullable(),
  stellvertretung: FLKontaktpersonSchema.nullable(),
  // Null is „Eine eigene Person“, what a block records where the Trainer holds only their own seat.
  trainer_ist_zugleich: FLTrainerZugleichSchema.nullable(),
});
export type FLSaisonTeamKontakte = z.infer<typeof FLSaisonTeamKontakteSchema>;

/**
 * Mirrors `FLSaisonTeamKontaktePayload` — the write side of the three, with the editor's German and
 * the empty slot an erasure leaves. Three whole people in a NEW block is the form's guarantee.
 */
export const FLSaisonTeamKontaktePayloadSchema = z.object({
  // Empty is what an erasure leaves; accepting it here is what keeps such a row editable at all.
  trainer: FLKontaktpersonPayloadSchema.nullable(),
  ansprechperson: FLKontaktpersonPayloadSchema.nullable(),
  stellvertretung: FLKontaktpersonPayloadSchema.nullable(),
  trainer_ist_zugleich: FLTrainerZugleichSchema.nullable(),
});
export type FLSaisonTeamKontaktePayload = z.infer<typeof FLSaisonTeamKontaktePayloadSchema>;

export const FLTeamStatistikSchema = z.object({
  anzahl_gespielte_spiele: z.int().nonnegative(),
  siege: z.int().nonnegative(),
  niederlagen: z.int().nonnegative(),
  unentschieden: z.int().nonnegative(),
  tore_geschossen: z.int().nonnegative(),
  tore_kassiert: z.int().nonnegative(),
  punkte: z.int().nonnegative(),
  // Every fixture called off, forfeits included. Beside the scoring, never in it.
  anzahl_abgesagte_spiele: z.int().nonnegative(),
});
export type FLTeamStatistik = z.infer<typeof FLTeamStatistikSchema>;

/**
 * The season-scoped read. `name` and `shorthand` are the junction's copy, so a club renamed after a
 * season finished still reads there under the name it played under (`docs/glossary.md :: Team`).
 */
export const FLTeamSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  gruppe: FLGruppenNamesSchema,

  statistik: FLTeamStatistikSchema,

  // Out of THIS season. Joined from the junction on every read, so it cannot go stale.
  austritt: FLAustrittSchema.nullable(),
  shorthand: z.string().length(2),
  description: z.string().max(DESCRIPTION_MAX_LENGTH),
  full_name: z.string().nonempty(),
  // Rendered straight into an href on a public page -- see ExternalUrlSchema for why not z.url().
  website_url: OptionalExternalUrlSchema,
  address: FLAddressSchema,
  // Null for a club that has not answered yet, which is why no surface may read a missing school type
  // as a private one.
  schulform: FLSchulformSchema.nullable(),
  // The day this CLUB left the league — not the same as leaving one season, which is
  // `austritt` on the junction.
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeam = z.infer<typeof FLTeamSchema>;

/**
 * Mirrors `FLGruppenTeam` — one row of a league table, and narrower than `FLTeamSchema` by design.
 * The table is rendered by a client component, so everything here is serialised into a public page,
 * and no cell reads a club's address.
 */
export const FLGruppenTeamSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  statistik: FLTeamStatistikSchema,
  // The record's TYPE alone, reusing the enum rather than restating it: a row marks that a club is
  // out of the season, and the club's own page publishes the reason and the date.
  austritt_type: FLAustrittSchema.shape.type.nullable(),
  // Fixtures neither counted nor called off, so points are still to be awarded here. This is the
  // term that lets a club yet to play its first fixture hold a placing (`docs/backend/spec.md :: I24b`).
  anzahl_ausstehende_spiele: z.int().nonnegative(),
});
export type FLGruppenTeam = z.infer<typeof FLGruppenTeamSchema>;

/**
 * All four keys are required: the backend seeds every group, and an omitted one fails this parse.
 *
 * Each list arrives in STANDING order. **Never re-sort one here** — the same ordering seeds the
 * playoff bracket.
 */
export const FLGruppenSchema = z.object({
  A: z.array(FLGruppenTeamSchema),
  B: z.array(FLGruppenTeamSchema),
  C: z.array(FLGruppenTeamSchema),
  D: z.array(FLGruppenTeamSchema),
});
export type FLGruppen = z.infer<typeof FLGruppenSchema>;

export const FLTeamsListResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("list"),
  teams: z.array(FLTeamSchema),
});
export type FLTeamsListResponse = z.infer<typeof FLTeamsListResponseSchema>;

export const FLTeamsGroupedResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("grouped"),
  gruppen: FLGruppenSchema,
  // The teams in a playoff place are a prefix of each list above, and a page cannot mark them
  // without knowing where that prefix ends.
  qualifiers_per_group: z.int().positive(),
});
export type FLTeamsGroupedResponse = z.infer<typeof FLTeamsGroupedResponseSchema>;

export const FLTeamsResponseSchema = z.discriminatedUnion("format", [FLTeamsListResponseSchema, FLTeamsGroupedResponseSchema]);
export type FLTeamsResponse = z.infer<typeof FLTeamsResponseSchema>;

/**
 * Outside `FLTeamsResponseSchema`: that union discriminates the shapes ONE endpoint can return, and
 * `GET /teams/{team_id}` is a different endpoint returning exactly one.
 */
export const FLTeamsSingleResponseSchema = BaseAPIResponseSchema.extend({
  format: z.literal("single"),
  team: FLTeamSchema,
});
export type FLTeamsSingleResponse = z.infer<typeof FLTeamsSingleResponseSchema>;

/** Shared by create and patch: the patch replaces them wholesale, so both carry the same field set. */
const teamPayloadFields = {
  // The ceilings are the application's, so both tiers refuse alike.
  name: z
    .string()
    .nonempty({ error: "Bitte gib einen Namen ein." })
    .max(TEAM_NAME_MAX_LENGTH, { error: `Der Name darf höchstens ${String(TEAM_NAME_MAX_LENGTH)} Zeichen lang sein.` }),
  // Exactly two characters, held unique across every club — retired ones included.
  shorthand: z.string().length(2, { error: "Das Kürzel besteht aus genau 2 Zeichen." }),
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, { error: `Die Beschreibung darf höchstens ${String(DESCRIPTION_MAX_LENGTH)} Zeichen lang sein.` }),
  full_name: z
    .string()
    .nonempty({ error: "Bitte gib den vollständigen Namen ein." })
    .max(TEAM_FULL_NAME_MAX_LENGTH, {
      error: `Der vollständige Name darf höchstens ${String(TEAM_FULL_NAME_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  website_url: ExternalUrlSchema.max(TEAM_WEBSITE_URL_MAX_LENGTH, {
    error: `Die Adresse darf höchstens ${String(TEAM_WEBSITE_URL_MAX_LENGTH)} Zeichen lang sein.`,
  }).nullable(),
  address: FLAddressPayloadSchema,
  // Required with no default, as the model states it: `PATCH` replaces the club wholesale, so an
  // omitted key would clear a stored school form and fan that out as an edit nobody asked for.
  schulform: FLSchulformSchema.nullable(),
};

export const FLPostTeamPayloadSchema = z.object(teamPayloadFields);
export type FLPostTeamPayload = z.infer<typeof FLPostTeamPayloadSchema>;

export const FLPatchTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  ...teamPayloadFields,
});
export type FLPatchTeamPayload = z.infer<typeof FLPatchTeamPayloadSchema>;

export const FLDeleteTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteTeamPayload = z.infer<typeof FLDeleteTeamPayloadSchema>;

export const FLReactivateTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLReactivateTeamPayload = z.infer<typeof FLReactivateTeamPayloadSchema>;

/**
 * One form, split by the action into two requests. One form on purpose: every list read joins the
 * junction strictly (backend spec I11), so a club created without a row is invisible to every
 * surface that could give it one.
 */
export const FLCreateTeamFormPayloadSchema = z.object({
  ...teamPayloadFields,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});
export type FLCreateTeamFormPayload = z.infer<typeof FLCreateTeamFormPayloadSchema>;

/**
 * Mirrors `FLTeamRecord`, the STORED document that every write echoes. Distinct from `FLTeam`:
 * re-reading the read shape would 404 for a club with no junction row this season — the normal
 * state for one being created or retired.
 */
export const FLTeamRecordSchema = z.object({
  id: CustomObjectIdStringSchema,

  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  description: z.string().max(DESCRIPTION_MAX_LENGTH),
  full_name: z.string().nonempty(),
  website_url: OptionalExternalUrlSchema,
  address: FLAddressSchema,
  schulform: FLSchulformSchema.nullable(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLTeamRecord = z.infer<typeof FLTeamRecordSchema>;

/** Mirrors `FLTeamMembership` — one junction row as seen from its club. */
export const FLTeamMembershipSchema = z.object({
  saison_id: z.string(),
  gruppe: FLGruppenNamesSchema,
  austritt: FLAustrittSchema.nullable(),
  // Per SEASON, not per club: a club plays in the colour it registered for that season, and last
  // season's kit is not evidence of this season's.
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
  kontakte: FLSaisonTeamKontakteSchema.nullable(),
});
export type FLTeamMembership = z.infer<typeof FLTeamMembershipSchema>;

/** Mirrors `FLTeamWithMemberships`. A different question from `FLTeam`, not a projection of it. */
export const FLTeamWithMembershipsSchema = FLTeamRecordSchema.extend({
  memberships: z.array(FLTeamMembershipSchema),
});
export type FLTeamWithMemberships = z.infer<typeof FLTeamWithMembershipsSchema>;

export const FLTeamsMembershipsResponseSchema = BaseAPIResponseSchema.extend({
  teams: z.array(FLTeamWithMembershipsSchema),
});
export type FLTeamsMembershipsResponse = z.infer<typeof FLTeamsMembershipsResponseSchema>;

export const FLPostTeamResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
});
export type FLPostTeamResponse = z.infer<typeof FLPostTeamResponseSchema>;

export const FLPatchTeamResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLTeamRecordSchema,
  // The rename's fan-out is the half of the endpoint that fails silently, so the count is surfaced
  // in the save toast rather than dropped.
  fanned_out_to_spiele: z.int().nonnegative(),
  // Reported beside the one above and never derived from it: this half reaches only the seasons that
  // are not `past`, so zero is the true answer for a club whose every season is closed.
  fanned_out_to_saison_teams: z.int().nonnegative(),
});
export type FLPatchTeamResponse = z.infer<typeof FLPatchTeamResponseSchema>;

/** What retire and reactivate echo — the stored record, for `FLTeamRecordSchema`'s reason. */
export const FLTeamWriteResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLTeamRecordSchema,
});
export type FLTeamWriteResponse = z.infer<typeof FLTeamWriteResponseSchema>;

export const FLPostSaisonTeamPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which club it is entering.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});
export type FLPostSaisonTeamPayload = z.infer<typeof FLPostSaisonTeamPayloadSchema>;

/**
 * The junction row's own fields. NO `kontakte` — `FLPatchSaisonTeamKontaktePayloadSchema` owns that
 * block, and the backend refuses one sent here.
 */
export const FLPatchSaisonTeamPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
  // The whole record, or `null` to lift one. REQUIRED with no default on either side: a form that
  // omits it gets a 422, never a team quietly reinstated.
  austritt: FLAustrittSchema.nullable(),
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});
export type FLPatchSaisonTeamPayload = z.infer<typeof FLPatchSaisonTeamPayloadSchema>;

/**
 * Which club takes a season's row over. The path names the club going OUT, so this is the one
 * junction payload naming a club the path does not.
 */
export const FLReplaceSaisonTeamPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the row being handed over is addressed by its natural key.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(4, { error: "Bitte wähle eine Saison." }),
  // The only field on the wire: the row keeps its group, and its copy of the identity is reseeded
  // from the incoming club, so a client-supplied name could only disagree with it.
  incoming_team_id: CustomObjectIdStringSchema,
});
export type FLReplaceSaisonTeamPayload = z.infer<typeof FLReplaceSaisonTeamPayloadSchema>;

/** A junction row, echoed as it was written — it has no read model of its own. */
export const FLSaisonTeamResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  austritt: FLAustrittSchema.nullable(),
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
  kontakte: FLSaisonTeamKontakteSchema.nullable(),
  // The season's own copy of the club's identity, on no payload: it is seeded from the club at entry
  // and rewritten by a rename only while the season is not `past`, so a client's copy could only be
  // stale.
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
});
export type FLSaisonTeamResponse = z.infer<typeof FLSaisonTeamResponseSchema>;

/**
 * The junction row as a replacement left it, plus the fan-out it carried into the fixtures. No
 * `austritt`: a replacement always clears it, so the field could carry only one value here.
 */
export const FLReplaceSaisonTeamResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  outgoing_team_id: CustomObjectIdStringSchema,
  incoming_team_id: CustomObjectIdStringSchema,
  // Untouched by the replacement, and echoed because the arriving club has to be told which group it
  // now stands in.
  gruppe: FLGruppenNamesSchema,
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
  kontakte: FLSaisonTeamKontakteSchema.nullable(),
  // Reseeded from the incoming club, exactly as entry seeds them.
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
  // Reported rather than assumed, as the rename's count is: this fan-out is the half of the endpoint
  // that fails silently.
  fanned_out_to_spiele: z.int().nonnegative(),
  // The outgoing club's live squad rows for this season, ausgetragen by the same transaction. Its
  // own figure beside the fixtures': the players did not transfer, and their registration survives.
  ausgetragene_squad_rows: z.int().nonnegative(),
});
export type FLReplaceSaisonTeamResponse = z.infer<typeof FLReplaceSaisonTeamResponseSchema>;
