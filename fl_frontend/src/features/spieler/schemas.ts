import z from "zod";

import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, PersonNameSchema } from "@/shared/schemas";

import { NUMMER_MUST_BE_DIGITS } from "./constants";

// Redesign: goes with its last importer.
/**
 * Mirrors `FLSpielerPosition`. German error because the squad editor's picker binds this directly;
 * an untouched picker submits null, which this refuses and the nullable wrappers below allow.
 */
export const FLSpielerPositionSchema = z.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"], { error: "Bitte wähle eine Position." });

// Redesign: goes with its last importer.
/** Mirrors `FLSpielerStufe` — the Hessen Oberstufe, both phases. */
export const FLSpielerStufeSchema = z.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"], { error: "Bitte wähle eine Stufe." });

// Redesign: goes with its last importer.
/**
 * Mirrors `FLSpielerRolle`. Slugs, so `ROLLE_OPTIONS` owns the German the reader sees; a squad holds
 * each of these once, which the write path refuses on (`REQ-SQUAD-004`).
 */
export const FLSpielerRolleSchema = z.enum(["kapitaen", "co_kapitaen"], { error: "Bitte wähle eine Rolle." });

// Redesign: goes with its last importer.
/**
 * A consent press's precondition, `FLEinwilligungStandPayload`: each choice's stand as the page was served it, null
 * where no evidence backs that choice, echoed unread, so nothing here reads or derives it.
 */
export const FLEinwilligungStandSchema = z.object({
  umfang: z.string().nullable(),
  medien: z.string().nullable(),
});

// Read schemas another lane's read mirror still composes (`features/konto`, `features/registrierungen`,
// `features/teams`); the generated types are the ones every reader imports, and these go with those mirrors.

/** Mirrors `FLEinwilligungBeleg` — when a person set one consent choice, and under which wording. */
const FLEinwilligungBelegSchema = z.object({
  // An instant in UTC, where the block carries a day: two acts on one day are ordered by it.
  am: z.string(),
  text_version: z.string(),
});

/** Mirrors `FLEinwilligungNachweis` — the act that set one choice's value, and on a withdrawal the grant it ended. */
const FLEinwilligungNachweisSchema = FLEinwilligungBelegSchema.extend({
  erteilt_zuvor: FLEinwilligungBelegSchema.nullable(),
});

/**
 * Mirrors `FLEinwilligungNachweise` — each choice's evidence, null until its person sets it. The pupil's,
 * the referee's and a contact seat's record all carry this one shape.
 */
export const FLEinwilligungNachweiseSchema = z.object({
  umfang: FLEinwilligungNachweisSchema.nullable(),
  medien: FLEinwilligungNachweisSchema.nullable(),
});

/** Mirrors `FLEinwilligung` — what may be published about this person. */
export const FLEinwilligungSchema = z.object({
  umfang: z.enum(["kader_oeffentlich", "intern"]),
  datum: CustomDateStringSchema,
  bestaetigt_am: CustomDateStringSchema,
  // A label of the backend's consent registry and never the words.
  text_version: z.string(),
  // A second consent under one record: `umfang` and this are independent answers, so a reader
  // deciding whether a photo may be published asks this one and never that one.
  medien: z.boolean(),
  nachweis: FLEinwilligungNachweiseSchema,
});

/** Mirrors `FLSpielerSelbstKaderZeile`: one squad row of the signed-in pupil, the team named as it played that season. */
const FLSpielerSelbstKaderZeileSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  team_name: z.string(),
  saison_id: z.string(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  rolle: FLSpielerRolleSchema.nullable(),
  ist_nachnominiert: z.boolean(),
  inactive_since: CustomDateStringSchema.nullable(),
});

/**
 * Mirrors `FLSpielerKontext`: what the pupil's confirmation page fills its slots with, as the record
 * points to it today. Null where the pupil holds no squad row to name a team by.
 */
export const FLSpielerKontextSchema = z.object({
  team: z.string().nullable(),
  schule: z.string().nullable(),
  saison: z.string().nullable(),
});

/**
 * Mirrors `FLSpielerSelbst`, the person tier's own read of the stored data: the whole surname, because
 * the reader is the person it names. Its consent is the account page's entry's, which extends it.
 */
export const FLSpielerSelbstSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  vorname: z.string().nonempty(),
  nachname: z.string().nullable(),
  geburtsdatum: CustomDateStringSchema,
  kader: z.array(FLSpielerSelbstKaderZeileSchema),
});

// Redesign: goes with its last importer.
/**
 * Replaces the person's own fields wholesale, so none is optional: an omitted surname would erase a
 * stored one.
 *
 * No uniqueness rule on a name — two people genuinely can share one.
 */
export const FLPatchSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  // The form submits null for an empty box, never an empty string — a surname often arrives later.
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }).nullable(),
  // Never null: a save clearing the date the person's registration carried would leave one whose age
  // no page can read.
  geburtsdatum: CustomDateStringSchema,
});
export type FLPatchSpielerPayload = z.infer<typeof FLPatchSpielerPayloadSchema>;

// Redesign: goes with its last importer.
export const FLDeleteSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteSpielerPayload = z.infer<typeof FLDeleteSpielerPayloadSchema>;

// Redesign: goes with its last importer.
export const FLReactivateSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLReactivateSpielerPayload = z.infer<typeof FLReactivateSpielerPayloadSchema>;

// Named rather than written into the field below.
const SQUAD_NUMMER_REGEX = /^\d{1,4}$/;

/**
 * No transforms — empty-to-null normalisation is the FORM boundary's. A schema that rewrote its
 * input would make `z.infer` disagree with what the form holds, which the squad editor's draft is typed by.
 */
const saisonSpielerPayloadFields = {
  team_id: CustomObjectIdStringSchema,
  // A string on the wire — worn rather than counted — but free text was never meant to admit a name.
  nummer: z.string().regex(SQUAD_NUMMER_REGEX, { error: NUMMER_MUST_BE_DIGITS }).nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  // On the junction: a role is held within one team for one season, not by the person. One field and
  // not a flag per role, so holding both at once cannot be expressed.
  rolle: FLSpielerRolleSchema.nullable(),
};

// Redesign: goes with its last importer.
export const FLPostSaisonSpielerPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which player it is entering.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPostSaisonSpielerPayload = z.infer<typeof FLPostSaisonSpielerPayloadSchema>;

// Redesign: goes with its last importer.
export const FLPatchSaisonSpielerPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPatchSaisonSpielerPayload = z.infer<typeof FLPatchSaisonSpielerPayloadSchema>;

// Redesign: goes with its last importer.
/** The junction row's natural key, for the two endpoints that carry no body. */
export const FLSaisonSpielerKeyPayloadSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
});
export type FLSaisonSpielerKeyPayload = z.infer<typeof FLSaisonSpielerKeyPayloadSchema>;

/** The three ids a squad row is addressed by on a seat holder's write, all of them in the PATH. */
const kaderZeileKeyFields = {
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  spieler_id: CustomObjectIdStringSchema,
};

// Redesign: goes with its last importer.
/**
 * Mirrors `FLPatchKaderZeilePayload`, wholesale: an omitted field would erase a stored one. The club
 * and the Nachnominierung are the stored row's, and a seat holder's write names neither.
 */
export const FLPatchKaderZeilePayloadSchema = z.object({
  ...kaderZeileKeyFields,
  nummer: z.string().regex(SQUAD_NUMMER_REGEX, { error: NUMMER_MUST_BE_DIGITS }).nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  rolle: FLSpielerRolleSchema.nullable(),
});
export type FLPatchKaderZeilePayload = z.infer<typeof FLPatchKaderZeilePayloadSchema>;

// Redesign: goes with its last importer.
/** The austragen's whole argument: the row's three ids, every one in the path, and no request body. */
export const FLKaderZeileKeyPayloadSchema = z.object(kaderZeileKeyFields);
export type FLKaderZeileKeyPayload = z.infer<typeof FLKaderZeileKeyPayloadSchema>;

/** A consent press's scope no control offers: a drifted page, which a reload repairs. */
export const WAHL_UNBEKANNT = "Diese Wahl kennen wir nicht. Lade die Seite neu.";

// Redesign: goes with its last importer.
/**
 * Mirrors `FLSpielerSelbstEinwilligungPayload`, and the referee's payload is this same schema: the two
 * writes are one shape, so the one consent control cannot send either a member the other lacks.
 */
export const FLSpielerSelbstEinwilligungPayloadSchema = z.object({
  umfang: z.enum(["kader_oeffentlich", "intern"], { error: WAHL_UNBEKANNT }),
  medien: z.boolean(),
  // The account page's own label, never the one the record was confirmed under: the backend judges it
  // against the page that took the press.
  text_version: z
    .string()
    .trim()
    .nonempty({ error: "Deine Wahl nennt keine Fassung. Lade die Seite neu." })
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  nachweis_stand: FLEinwilligungStandSchema,
});

// Redesign: goes with its last importer.
/**
 * The label a link confirmation's answer names: each endpoint floors it, and the page fills it from
 * the served label, so only a drifted page sends none, which the link reopened repairs.
 */
export const LinkAntwortTextVersionSchema = z
  .string()
  .trim()
  .nonempty({ error: "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail erneut." })
  .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
    error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
  });
