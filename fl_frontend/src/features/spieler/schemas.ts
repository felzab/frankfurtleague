import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, PersonNameSchema } from "@/shared/schemas";

import { NUMMER_MUST_BE_DIGITS } from "./constants";

/**
 * Mirrors `FLSpielerPosition`. German error because the squad editor's picker binds this directly;
 * an untouched picker submits null, which this refuses and the nullable wrappers below allow.
 */
export const FLSpielerPositionSchema = z.enum(["Tor", "Abwehr", "Mittelfeld", "Angriff"], { error: "Bitte wähle eine Position." });
export type FLSpielerPosition = z.infer<typeof FLSpielerPositionSchema>;

/** Mirrors `FLSpielerStufe` — the Hessen Oberstufe, both phases. */
export const FLSpielerStufeSchema = z.enum(["E1", "E2", "Q1", "Q2", "Q3", "Q4"], { error: "Bitte wähle eine Stufe." });
export type FLSpielerStufe = z.infer<typeof FLSpielerStufeSchema>;

/**
 * Mirrors `FLSpielerRolle`. Slugs, so `ROLLE_OPTIONS` owns the German the reader sees; a squad holds
 * each of these once, which the write path refuses on (`REQ-SQUAD-004`).
 */
export const FLSpielerRolleSchema = z.enum(["kapitaen", "co_kapitaen"], { error: "Bitte wähle eine Rolle." });
export type FLSpielerRolle = z.infer<typeof FLSpielerRolleSchema>;

/** Mirrors `FLEinwilligungBeleg` — when a person set one consent choice, and under which wording. */
export const FLEinwilligungBelegSchema = z.object({
  // An instant in UTC, where the block carries a day: two acts on one day are ordered by it.
  am: z.string(),
  text_version: z.string(),
});
export type FLEinwilligungBeleg = z.infer<typeof FLEinwilligungBelegSchema>;

/** Mirrors `FLEinwilligungNachweis` — the act that set one choice's value, and on a withdrawal the grant it ended. */
export const FLEinwilligungNachweisSchema = FLEinwilligungBelegSchema.extend({
  erteilt_zuvor: FLEinwilligungBelegSchema.nullable(),
});
export type FLEinwilligungNachweis = z.infer<typeof FLEinwilligungNachweisSchema>;

/**
 * Mirrors `FLEinwilligungNachweise` — each choice's evidence, null until its person sets it. The pupil's,
 * the referee's and a contact seat's record all carry this one shape.
 */
export const FLEinwilligungNachweiseSchema = z.object({
  umfang: FLEinwilligungNachweisSchema.nullable(),
  medien: FLEinwilligungNachweisSchema.nullable(),
});
export type FLEinwilligungNachweise = z.infer<typeof FLEinwilligungNachweiseSchema>;

/**
 * Mirrors `FLEinwilligungStand` — each choice's stand as the page was served it, null where no evidence
 * backs that choice: a consent press echoes it as its precondition, so nothing here reads or derives it.
 */
export const FLEinwilligungStandSchema = z.object({
  umfang: z.string().nullable(),
  medien: z.string().nullable(),
});
export type FLEinwilligungStand = z.infer<typeof FLEinwilligungStandSchema>;

// The press echoes the stand as the read served it, so the payload is the read shape itself.
export const FLEinwilligungStandPayloadSchema = FLEinwilligungStandSchema;
export type FLEinwilligungStandPayload = z.infer<typeof FLEinwilligungStandPayloadSchema>;

/**
 * Mirrors `FLEinwilligung` — what may be published about this person.
 *
 * `bestandsuebernahme` marks a backfilled record, which must stay distinguishable from consent
 * somebody actually gave. A null `bestaetigt_am` is UNCONFIRMED.
 */
export const FLEinwilligungSchema = z.object({
  umfang: z.enum(["kader_oeffentlich", "intern"]),
  // Who answered, on a record stored before no write named one; null on every record since.
  erteilt_von: z.enum(["erziehungsberechtigt", "volljaehrig", "bestandsuebernahme"]).nullable(),
  datum: CustomDateStringSchema.nullable(),
  bestaetigt_am: CustomDateStringSchema.nullable(),
  // A label of the backend's consent registry and never the words; null on every record stored
  // before the registration flow stamped one.
  text_version: z.string().nullable(),
  // A second consent under one record: `umfang` and this are independent answers, so a reader
  // deciding whether a photo may be published asks this one and never that one.
  medien: z.boolean(),
  nachweis: FLEinwilligungNachweiseSchema,
});
export type FLEinwilligung = z.infer<typeof FLEinwilligungSchema>;

/**
 * Mirrors `FLSpielerPublic` — an ALLOW-LIST: every field is one the squad table renders. `nachname`
 * arrives as an INITIAL carrying its own dot (`READ-PUPIL-001`), so a joined name and an avatar
 * letter read as they would from a whole surname.
 */
export const FLSpielerPublicSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Both names arrive `null` for a person the publication gate withholds (`READ-PUPIL-003`), so a
  // non-empty rule here would refuse the answer the API is entitled to give.
  vorname: z.string().nullable(),
  nachname: z.string().nullable(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
});
export type FLSpielerPublic = z.infer<typeof FLSpielerPublicSchema>;

export const FLSpielerListResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerPublicSchema),
});
export type FLSpielerListResponse = z.infer<typeof FLSpielerListResponseSchema>;

/**
 * Mirrors `FLSpielerMembership`. Carries `inactive_since`, unlike the team junction: a squad row
 * really is retired when a player leaves mid-season, while a team never leaves a season.
 */
export const FLSpielerMembershipSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  ist_nachnominiert: z.boolean(),
  rolle: FLSpielerRolleSchema.nullable(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpielerMembership = z.infer<typeof FLSpielerMembershipSchema>;

/**
 * Mirrors `FLSpielerWithMemberships`. A different question from `FLSpieler`, not a projection of it:
 * that shape flattens against one season, so it can report neither a player in two nor one in none.
 */
export const FLSpielerWithMembershipsSchema = z.object({
  id: CustomObjectIdStringSchema,
  vorname: z.string().nonempty(),
  nachname: z.string().nullable(),
  // The day the PERSON left the league; a squad row's own retirement is on the membership.
  inactive_since: CustomDateStringSchema.nullable(),
  // Nullable for `einwilligung`'s reason below, over a person stored before the field existed.
  geburtsdatum: CustomDateStringSchema.nullable(),
  // Nullable rather than optional, mirroring the backend default: a person stored before consent
  // was collected has no record, and this tier is the only one that may read one.
  einwilligung: FLEinwilligungSchema.nullable(),
  // The address the person signs in on, folded. Read-only wherever it renders: no payload carries
  // it, so a control bound to this key would offer a write the API refuses.
  email: z.string().nullable(),
  memberships: z.array(FLSpielerMembershipSchema),
});
export type FLSpielerWithMemberships = z.infer<typeof FLSpielerWithMembershipsSchema>;

export const FLSpielerMembershipsResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSpielerWithMembershipsSchema),
});
export type FLSpielerMembershipsResponse = z.infer<typeof FLSpielerMembershipsResponseSchema>;

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
  // Nullable, and the form states the null rather than omitting: no flow collects a pupil's own
  // date yet (`fl_backend/app/core/domain.py :: UNENFORCED`).
  geburtsdatum: CustomDateStringSchema.nullable(),
});
export type FLPatchSpielerPayload = z.infer<typeof FLPatchSpielerPayloadSchema>;

export const FLDeleteSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLDeleteSpielerPayload = z.infer<typeof FLDeleteSpielerPayloadSchema>;

export const FLReactivateSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLReactivateSpielerPayload = z.infer<typeof FLReactivateSpielerPayloadSchema>;

/**
 * The ERASURE's whole argument: the id in the path, no request body. Its own schema and not the
 * retire's — one stamps a date and the other removes the person, and a shared payload would let a
 * caller reach the second while reading as the first.
 */
export const FLEraseSpielerPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLEraseSpielerPayload = z.infer<typeof FLEraseSpielerPayloadSchema>;

// Named rather than written into the field below, so `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_PATTERNS`
// can pair it with the backend's spelling.
const SQUAD_NUMMER_REGEX = /^\d{1,4}$/;

/**
 * No transforms — empty-to-null normalisation is the FORM boundary's. A schema that rewrote its
 * input would make `z.infer` disagree with what the form holds, and `apiContract.test.ts` compares
 * this shape to the published document.
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

export const FLPostSaisonSpielerPayloadSchema = z.object({
  // In the PATH on the wire; carried here because the form has to know which player it is entering.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPostSaisonSpielerPayload = z.infer<typeof FLPostSaisonSpielerPayloadSchema>;

export const FLPatchSaisonSpielerPayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key.
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  ...saisonSpielerPayloadFields,
});
export type FLPatchSaisonSpielerPayload = z.infer<typeof FLPatchSaisonSpielerPayloadSchema>;

/** The junction row's natural key, for the two endpoints that carry no body. */
export const FLSaisonSpielerKeyPayloadSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
});
export type FLSaisonSpielerKeyPayload = z.infer<typeof FLSaisonSpielerKeyPayloadSchema>;

/**
 * Mirrors `FLSpielerAdminSingleResponse` — the person alone, which is all the three admin
 * name-writes echo: squad fields are season-scoped and this path names no season. The base tier's
 * `FLSpielerSingleResponse` has no caller here, so no mirror.
 */
export const FLSpielerAdminSingleResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  // No floor, `FLSpielerSingleResponse` stating none: a read refusing what the API can serve reports
  // the name-write that echoed it as failed.
  vorname: z.string(),
  nachname: z.string().nullable(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSpielerAdminSingleResponse = z.infer<typeof FLSpielerAdminSingleResponseSchema>;

/**
 * Mirrors `FLSpielerErasureResponse` — what the erasure removed, and never an echo of the person: a
 * name or a consent record here would hand back a fresh copy of exactly what was erased.
 */
export const FLSpielerErasureResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  erased_saison_spieler: z.int().nonnegative(),
  // No log row is dropped — images are emptied in place and stamped — so this is never a deletion count.
  redacted_aktionen: z.int().nonnegative(),
});
export type FLSpielerErasureResponse = z.infer<typeof FLSpielerErasureResponseSchema>;

/** A junction row, echoed as it was written — it has no read model of its own. */
export const FLSaisonSpielerResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  ist_nachnominiert: z.boolean(),
  rolle: FLSpielerRolleSchema.nullable(),
  inactive_since: CustomDateStringSchema.nullable(),
});
export type FLSaisonSpielerResponse = z.infer<typeof FLSaisonSpielerResponseSchema>;

/**
 * Mirrors `FLSpielerNachnominierungResponse`: the verdict the squad create will store, served rather
 * than recomputed here so the editor announces what the row will say.
 */
export const FLSpielerNachnominierungResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  nachnominierung: z.boolean(),
});
export type FLSpielerNachnominierungResponse = z.infer<typeof FLSpielerNachnominierungResponseSchema>;

/**
 * Mirrors `FLKaderZeile`, a squad row as its team's seat holder reads it: the surname whole, never the
 * public initial. A key added for an address or a telephone number reaches every seat holder of the team.
 */
export const FLKaderZeileSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  vorname: z.string().nonempty(),
  nachname: z.string().nullable(),
  nummer: z.string().nullable(),
  position: FLSpielerPositionSchema.nullable(),
  stufe: FLSpielerStufeSchema.nullable(),
  rolle: FLSpielerRolleSchema.nullable(),
  ist_nachnominiert: z.boolean(),
  // Set on a row taken out of the squad, which a seat holder reads and never edits.
  inactive_since: CustomDateStringSchema.nullable(),
  // Composed by the backend over the squad's live rows, comparing the stored strings: „07“ is not „7“.
  nummer_doppelt: z.boolean(),
});
export type FLKaderZeile = z.infer<typeof FLKaderZeileSchema>;

/** Mirrors `FLKaderResponse`: the squad, and the levels the season admits, which are all its form may offer. */
export const FLKaderResponseSchema = BaseAPIResponseSchema.extend({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  erlaubte_stufen: z.array(FLSpielerStufeSchema).min(1),
  kader: z.array(FLKaderZeileSchema),
});
export type FLKaderResponse = z.infer<typeof FLKaderResponseSchema>;

/** Mirrors `FLKaderZeileResponse`: the row as a seat holder's write left it. */
export const FLKaderZeileResponseSchema = BaseAPIResponseSchema.extend(FLKaderZeileSchema.shape);
export type FLKaderZeileResponse = z.infer<typeof FLKaderZeileResponseSchema>;

/** The three ids a squad row is addressed by on a seat holder's write, all of them in the PATH. */
const kaderZeileKeyFields = {
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  spieler_id: CustomObjectIdStringSchema,
};

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

/** The austragen's whole argument: the row's three ids, every one in the path, and no request body. */
export const FLKaderZeileKeyPayloadSchema = z.object(kaderZeileKeyFields);
export type FLKaderZeileKeyPayload = z.infer<typeof FLKaderZeileKeyPayloadSchema>;

/** Mirrors `FLSpielerSelbstKaderZeile`: one squad row of the signed-in pupil, the team named as it played that season. */
export const FLSpielerSelbstKaderZeileSchema = z.object({
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
export type FLSpielerSelbstKaderZeile = z.infer<typeof FLSpielerSelbstKaderZeileSchema>;

/**
 * Mirrors `FLSpielerKontext`: what the pupil's confirmation page fills its slots with, as the record
 * points to it today. Null where the pupil holds no squad row to name a team by.
 */
export const FLSpielerKontextSchema = z.object({
  vorname: z.string(),
  team: z.string().nullable(),
  schule: z.string().nullable(),
  saison: z.string().nullable(),
});
export type FLSpielerKontext = z.infer<typeof FLSpielerKontextSchema>;

/** Mirrors `FLSpielerSelbst`, the person tier's own read: the whole surname, because the reader is the person it names. */
export const FLSpielerSelbstSchema = z.object({
  spieler_id: CustomObjectIdStringSchema,
  vorname: z.string().nonempty(),
  nachname: z.string().nullable(),
  geburtsdatum: CustomDateStringSchema.nullable(),
  inactive_since: CustomDateStringSchema.nullable(),
  // Never null here: the read serves confirmed records alone, an unconfirmed one holding nothing to withdraw.
  einwilligung: FLEinwilligungSchema,
  // The label whose words the account page shows beside the control: the backend names which stored
  // label the person confirmed, so the page never decides it from the record's shape.
  bestaetigt_text_version: z.string().nullable(),
  // What the consent press sends back as its precondition, so a press from a page another tab has
  // since moved is refused rather than undoing that tab's choice.
  nachweis_stand: FLEinwilligungStandSchema,
  kontext: FLSpielerKontextSchema,
  // The backend's verdicts, never recomputed here: a second clock or a second reading of a panel would
  // offer a press the write refuses.
  erteilbar: z.boolean(),
  medien_angeboten: z.boolean(),
  kader: z.array(FLSpielerSelbstKaderZeileSchema),
});
export type FLSpielerSelbst = z.infer<typeof FLSpielerSelbstSchema>;

export const FLSpielerSelbstResponseSchema = BaseAPIResponseSchema.extend({
  spieler: FLSpielerSelbstSchema,
});
export type FLSpielerSelbstResponse = z.infer<typeof FLSpielerSelbstResponseSchema>;

/**
 * Mirrors `FLSpielerSelbstEinwilligungPayload`, and the referee's payload is this same schema: the two
 * writes are one shape, so the one consent control cannot send either a member the other lacks.
 */
export const FLSpielerSelbstEinwilligungPayloadSchema = z.object({
  // No control offers another value, so one is a drifted page, which a reload repairs.
  umfang: z.enum(FLEinwilligungSchema.shape.umfang.options, { error: "Diese Wahl kennen wir nicht. Lade die Seite neu." }),
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
  nachweis_stand: FLEinwilligungStandPayloadSchema,
});
export type FLSpielerSelbstEinwilligungPayload = z.infer<typeof FLSpielerSelbstEinwilligungPayloadSchema>;

/**
 * The label a link confirmation's answer names: each endpoint floors it, and the page fills it from
 * the served label, so only a drifted page sends none, which the link reopened repairs.
 */
export const LinkAntwortTextVersionSchema = z
  .string()
  .trim()
  .nonempty({ error: "Deine Antwort nennt keine Fassung. Öffne den Link aus Deiner E-Mail noch einmal." })
  .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
    error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
  });

export const FLSpielerSelbstEinwilligungResponseSchema = BaseAPIResponseSchema.extend({
  spieler_id: CustomObjectIdStringSchema,
  einwilligung: FLEinwilligungSchema,
  // The stand this press left, which the page's next press sends.
  nachweis_stand: FLEinwilligungStandSchema,
});
export type FLSpielerSelbstEinwilligungResponse = z.infer<typeof FLSpielerSelbstEinwilligungResponseSchema>;
