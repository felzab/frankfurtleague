// Redesign: goes with its last importer.
import z from "zod";

import { FLAustrittType, FLGruppenNames, FLSchulform, FLTrainerAlso, FLTrikotFarbe } from "@/core/generated/client/types";
// The applications slice declares this width, a school proposing a Kürzel before any club exists to
// hold it (`docs/glossary.md :: Kürzel`). A literal beside it is compared by nothing.
import { KUERZEL_LAENGE } from "@/features/bewerbungen/constants";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import {
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  KontaktEmailSchema,
  PersonNameSchema,
  PHONE_REGEX,
  singleLineName,
} from "@/shared/schemas";

import {
  DESCRIPTION_MAX_LENGTH,
  EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
  KONTAKT_NAME_MAX_LENGTH,
  KONTAKT_NAME_ZU_LANG,
  TEAM_FULL_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_WEBSITE_URL_MAX_LENGTH,
} from "./constants";
import { kontaktePersonenRegeln } from "./kontaktePersonen";

// The old club, junction and contact forms' own judgement of their drafts, in words an administrator reads, before
// each action sends the write through the generated client, which types the body against the write's published
// contract.

/** A closed set. German error because the group picker binds this schema, and an untouched picker submits null. */
export const FLGruppenNamesSchema = z.enum(FLGruppenNames, { error: "Bitte wähle eine Gruppe." });

/**
 * Trimmed before its floor, mirroring `fl_backend/app/api/teams/schemas.py :: FLAustrittPayload`. German because
 * the junction editor binds this schema to its inputs, and an untouched picker submits null.
 */
const FLAustrittPayloadSchema = z.object({
  type: z.enum(FLAustrittType, { error: "Bitte wähle, wie das Team ausgeschieden ist." }),
  // Free text written for publication: rendered as authored, never truncated to a label.
  grund: z.string().trim().nonempty({ error: "Bitte gib einen Grund an." }),
  datum: CustomDateStringSchema,
});

/**
 * No German error: the club editor offers `Keine Angabe` beside the six, so an unanswered picker is a null the field
 * accepts rather than a refusal.
 */
export const FLSchulformSchema = z.enum(FLSchulform, {
  // Named rather than enumerated: the picker is already showing the six, and Zod's own default
  // answers a person by listing the slugs the wire uses.
  error: "Bitte wähle eine Schulform.",
});

/**
 * The league's kit palette. The slug is what travels; its German name and its swatch are
 * `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`.
 */
export const FLTrikotFarbeSchema = z.enum(FLTrikotFarbe, {
  // Named rather than enumerated, for `FLSchulformSchema`'s reason: a list of slugs is not an answer.
  error: "Bitte wähle eine Trikotfarbe.",
});

/** German throughout: the team editor binds it to its inputs. */
export const FLKontaktKenntnisnahmePayloadSchema = z.object({
  // Written by the form from `EINWILLIGUNG_UMFANG` rather than picked: one scope exists, so a control
  // offering it would ask a question with one answer.
  umfang: z.literal("kontaktdaten", { error: "Die Kenntnisnahme gilt ausschließlich für Kontaktdaten." }),
  // No `eingetragen_von` and no `bestaetigt_am`: both are the server's to compose, and a payload that
  // could name the stamp would let an administrator file a transcription as the person's own answer.
  text_version: z
    .string()
    .trim()
    .nonempty({ error: "Die Kenntnisnahme nennt keine Fassung. Lade die Seite neu." })
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  datum: CustomDateStringSchema,
});

/** German throughout: the team editor binds it to its inputs. */
const FLKontaktpersonPayloadSchema = z.object({
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  email: KontaktEmailSchema,
  telefon: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  // No `geburtsdatum`: the payload carries none, and a mirror requiring one refuses every seat whose
  // person has not confirmed yet.
  einwilligung: FLKontaktKenntnisnahmePayloadSchema,
});

/**
 * Which OTHER seat the Trainer also holds. One nullable field rather than two flags, which would let a row claim both
 * seats at once.
 */
export const FLTrainerZugleichSchema = z.enum(FLTrainerAlso, {
  error: "Bitte wähle, wer zugleich Trainerin oder Trainer ist.",
});

const SITZE_LESBAR_ODER_LEER = z.object({
  ansprechperson: z.object({}).nullable(),
  stellvertretung: z.object({}).nullable(),
  trainer: z.object({}).nullable(),
});

/**
 * The write side of the three seats, with the editor's German and the empty slot an erasure leaves. Three whole people
 * in a NEW block is the form's guarantee.
 */
export const FLSaisonTeamKontaktePayloadSchema = z
  .object({
    // Empty is what an erasure leaves; accepting it here is what keeps such a row editable at all.
    trainer: FLKontaktpersonPayloadSchema.nullable(),
    ansprechperson: FLKontaktpersonPayloadSchema.nullable(),
    stellvertretung: FLKontaktpersonPayloadSchema.nullable(),
    trainer_is_also: FLTrainerZugleichSchema.nullable(),
  })
  // The application's two rules, so a refusal lands on the box rather than on a 422 naming the block.
  .superRefine(
    kontaktePersonenRegeln({
      email: FLKontaktpersonPayloadSchema.shape.email,
      telefon: FLKontaktpersonPayloadSchema.shape.telefon,
      zugleich: FLTrainerZugleichSchema,
    }),
    // Asked rather than zod's default, which skips a refinement once any check in the block aborts.
    { when: ({ value }) => SITZE_LESBAR_ODER_LEER.safeParse(value).success },
  );

/** Shared by create and patch: the patch replaces them wholesale, so both carry the same field set. */
const teamPayloadFields = {
  // The ceilings and the single-line class are the application's, so both tiers refuse alike.
  name: singleLineName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib einen Namen ein." })
      .max(TEAM_NAME_MAX_LENGTH, { error: `Der Name darf höchstens ${String(TEAM_NAME_MAX_LENGTH)} Zeichen lang sein.` }),
    "Der Name",
  ),
  // Held unique across every club, retired ones included (`fl_backend/app/core/constraints.py :: uniq_shorthand`).
  shorthand: z
    .string()
    .trim()
    .length(KUERZEL_LAENGE, { error: `Das Kürzel besteht aus genau ${String(KUERZEL_LAENGE)} Zeichen.` }),
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH, { error: `Die Beschreibung darf höchstens ${String(DESCRIPTION_MAX_LENGTH)} Zeichen lang sein.` }),
  full_name: singleLineName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib den vollständigen Namen ein." })
      .max(TEAM_FULL_NAME_MAX_LENGTH, {
        error: `Der vollständige Name darf höchstens ${String(TEAM_FULL_NAME_MAX_LENGTH)} Zeichen lang sein.`,
      }),
    "Der vollständige Name",
  ),
  // `null` is the one spelling of absence and `""` is not admitted: the value lands in an `href`, and
  // `javascript:` parses as a URL.
  website_url: ExternalUrlSchema.max(TEAM_WEBSITE_URL_MAX_LENGTH, {
    error: `Die Adresse darf höchstens ${String(TEAM_WEBSITE_URL_MAX_LENGTH)} Zeichen lang sein.`,
  }).nullable(),
  address: FLAddressPayloadSchema,
  // Required with no default, as the model states it: `PATCH` replaces the club wholesale, so an
  // omitted key would clear a stored school form and fan that out as an edit nobody asked for.
  schulform: FLSchulformSchema.nullable(),
};

export const FLPatchTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  ...teamPayloadFields,
});

export const FLDeleteTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});

export const FLReactivateTeamPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});

/**
 * One form, split by the action into two requests. One form on purpose: every list read joins the
 * junction strictly, so a club created without a row is invisible to every
 * surface that could give it one.
 */
export const FLCreateTeamFormPayloadSchema = z.object({
  ...teamPayloadFields,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});

export const FLPostSaisonTeamPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which club it is entering.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
});

/**
 * The junction row's own fields. NO `kontakte` — the contacts editor's payload owns that block, and the backend
 * refuses one sent here.
 */
export const FLPatchSaisonTeamPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  gruppe: FLGruppenNamesSchema,
  // The whole record, or `null` to lift one. REQUIRED with no default on either side: a form that
  // omits it gets a 422, never a team quietly reinstated.
  austritt: FLAustrittPayloadSchema.nullable(),
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});

/**
 * Which club takes a season's row over. The path names the club going OUT, so this is the one
 * junction payload naming a club the path does not.
 */
export const FLReplaceSaisonTeamPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the row being handed over is addressed by its natural key.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  // The only field on the wire: the row keeps its group, and its copy of the identity is reseeded
  // from the incoming club, so a client-supplied name could only disagree with it.
  incoming_team_id: CustomObjectIdStringSchema,
});
