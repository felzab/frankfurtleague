import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
// The application's own derivation, not a copy of it: the two flows bound a birthdate by the same
// two numbers, and a second span here would refuse a day the endpoint takes.
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
// The season slice's own mirror rather than a second enum: two copies of one published set drift,
// and the invite read answers the same three members the season's own read does.
import { FLSaisonStatusSchema } from "@/features/saisons/schemas";
import { FLPostSaisonSpielerPayloadSchema, FLSpielerPositionSchema, FLSpielerStufeSchema } from "@/features/spieler/schemas";
import { EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, KONTAKT_NAME_MAX_LENGTH } from "@/features/teams/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, KontaktEmailSchema, PersonNameSchema } from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import { alterAusserhalb, EINWILLIGUNG_UMFANG_OPTIONS } from "./constants";

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link noch einmal.";

/**
 * Mirrors `fl_backend/app/api/bewerbungen/schemas.py :: CustomBewerbungToken`: both of this slice's
 * tokens are minted by `fl_backend/app/api/bewerbungen/services.py :: mint_token`.
 *
 * One sentence for the missing token and the over-long one, a visitor having typed neither.
 */
const registrierungToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

/**
 * The invite read's payload: the token, in a body and never in a query string. The token is the
 * credential, and a second URL carrying it is a second line the edge has to redact.
 */
export const FLEinladungAnsichtPayloadSchema = z.object({ token: registrierungToken });
export type FLEinladungAnsichtPayload = z.infer<typeof FLEinladungAnsichtPayloadSchema>;

/**
 * What an invite's holder is told before anything is typed. Nothing here is a person's data, and the
 * whole of it is what the chat message that carried the link already said.
 */
export const FLEinladungAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  team: z.string(),
  // The club's own `full_name`: a club here IS a school, and the junction row denormalises the short
  // name alone.
  schule: z.string(),
  saison_id: z.string(),
  saison_status: FLSaisonStatusSchema,
  // The server's whole judgement about the window, never re-derived here: a page deriving it would
  // go on offering a form the write path refuses.
  laeuft: z.boolean(),
  // What the form may offer. The write refuses everything outside it, so the select is built from
  // this and never from the league's whole set.
  erlaubte_stufen: z.array(FLSpielerStufeSchema),
  kader_frei: z.boolean(),
  // Whether the season holds a junction row for the invite's team. False is a complete open
  // form whose every submission the write refuses, so the page words it before anything is typed.
  team_eingetragen: z.boolean(),
  nachnominierung: z.boolean(),
});
export type FLEinladungAnsichtResponse = z.infer<typeof FLEinladungAnsichtResponseSchema>;

/**
 * One pupil's registration.
 *
 * The three optional fields are nullable rather than omitted, as `FLPostSaisonSpielerPayload`
 * requires: an absent key and a chosen „keine Angabe" read alike otherwise.
 */
export const FLPostRegistrierungPayloadSchema = z.object({
  token: registrierungToken,
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: "Dieser Vorname ist zu lang." }),
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: "Dieser Nachname ist zu lang." }),
  email: KontaktEmailSchema,
  position: FLSpielerPositionSchema.nullable(),
  // The squad payload's own field, never a second regex: a pupil types the number an administrator
  // later edits, and two spellings are how one tier starts refusing what the other takes.
  nummer: FLPostSaisonSpielerPayloadSchema.shape.nummer,
  stufe: FLSpielerStufeSchema.nullable(),
});
export type FLPostRegistrierungPayload = z.infer<typeof FLPostRegistrierungPayloadSchema>;

/**
 * The submission's echo. `bestaetigung_token` is the raw link value, answered here and recoverable
 * from nothing afterwards: it reaches the mail this handler composes and no other reader.
 */
export const FLPostRegistrierungResponseSchema = BaseAPIResponseSchema.extend({
  registrierung_id: CustomObjectIdStringSchema,
  bestaetigung_token: z.string(),
  frist: CustomDateStringSchema,
  email: z.string(),
  // Off the invite the token opened, so the mail addresses a pupil by their team without trusting a
  // browser for the words the league's own message carries.
  team: z.string(),
  saison_id: z.string(),
});
export type FLPostRegistrierungResponse = z.infer<typeof FLPostRegistrierungResponseSchema>;

/** The confirmation read's payload, carrying the token alone for `FLEinladungAnsichtPayloadSchema`'s reason. */
export const FLRegistrierungBestaetigungAnsichtPayloadSchema = z.object({ token: registrierungToken });
export type FLRegistrierungBestaetigungAnsichtPayload = z.infer<typeof FLRegistrierungBestaetigungAnsichtPayloadSchema>;

// The message an UNANSWERED control raises as well as a drifted one: nothing preselects this choice.
/** Mirrors `fl_backend/app/core/constraints.py :: _EINWILLIGUNG_UMFANG`. */
export const FLEinwilligungUmfangSchema = z.enum(EINWILLIGUNG_UMFANG_OPTIONS, {
  error: "Bitte wähle aus, was auf der Website stehen darf.",
});
export type FLEinwilligungUmfang = z.infer<typeof FLEinwilligungUmfangSchema>;

/**
 * What a confirmation link is told before any press.
 *
 * The surname never travels, so a leaked link learns no name to look anything up against. The
 * three stored answers are null for a first registration.
 */
export const FLRegistrierungBestaetigungAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  zustand: z.enum(["gueltig", "bestaetigt", "abgelaufen"]),
  team: z.string(),
  schule: z.string(),
  saison_id: z.string(),
  // Never null: the endpoint answers a state for a spent or lapsed link and this name only
  // reaches a page that renders the form.
  vorname: z.string(),
  text_version: z.string().nullable(),
  // The floor the answer is judged by. The page bounds its date control and words its sentences from
  // this rather than from a constant of its own.
  mindestalter: z.number().int(),
  geburtsdatum: CustomDateStringSchema.nullable(),
  umfang: FLEinwilligungUmfangSchema.nullable(),
  medien: z.boolean().nullable(),
});
export type FLRegistrierungBestaetigungAnsichtResponse = z.infer<typeof FLRegistrierungBestaetigungAnsichtResponseSchema>;

// The endpoint refuses the age and the handler lands that refusal on the date field, so a floor
// retyped here would be a second copy nothing compares.

/** One person, one press, one token spent. **It bounds no age**: the floor arrives with the link's own read. */
export const FLRegistrierungBestaetigungPayloadSchema = z.object({
  token: registrierungToken,
  geburtsdatum: CustomDateStringSchema,
  umfang: FLEinwilligungUmfangSchema,
  // Separately answered from `umfang`, and the endpoint stores both: one press carries two
  // consents, and a media permission folded into the scope would be one nobody gave on its own.
  medien: z.boolean(),
  // The version this page rendered, never the one a later reader would be shown: the record has
  // to cite the words the confirming person read.
  text_version: z
    .string()
    .trim()
    .nonempty({ error: "Die Bestätigung nennt keine Fassung. Lade die Seite neu." })
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
});
export type FLRegistrierungBestaetigungPayload = z.infer<typeof FLRegistrierungBestaetigungPayloadSchema>;

/**
 * The page's own, built at the floor the link answered: the date is judged against the German day
 * here as the endpoint judges it, so both tiers refuse the same two numbers on the same day.
 */
export const buildRegistrierungBestaetigungPayloadSchema = (mindestalter: number) =>
  FLRegistrierungBestaetigungPayloadSchema.extend({
    geburtsdatum: CustomDateStringSchema.refine(
      (datum) => {
        const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

        return datum >= frueheste && datum <= spaeteste;
      },
      { error: alterAusserhalb(mindestalter) },
    ),
  });

/** The write's echo: what was stored for this pupil, and nothing about any other row. */
export const FLRegistrierungBestaetigungResponseSchema = BaseAPIResponseSchema.extend({
  ergebnis: z.literal("bestaetigt"),
  geburtsdatum: CustomDateStringSchema,
  umfang: FLEinwilligungUmfangSchema,
  medien: z.boolean(),
});
export type FLRegistrierungBestaetigungResponse = z.infer<typeof FLRegistrierungBestaetigungResponseSchema>;

/**
 * One reminder the pass stamped and left for the caller to send.
 *
 * `token` is the RAW value the pass just minted, recoverable from nothing afterwards. The first
 * link stays live beside it.
 */
export const FLRegistrierungSweepErinnerungSchema = z.object({
  registrierung_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  team: z.string(),
  vorname: z.string(),
  email: z.string(),
  token: z.string(),
});
export type FLRegistrierungSweepErinnerung = z.infer<typeof FLRegistrierungSweepErinnerungSchema>;

/**
 * One pupil whose confirmed registration the pass erased at the season's end.
 *
 * It carries no token: the row is gone by the time this is answered, which is what makes the note a
 * report rather than a request.
 */
export const FLRegistrierungSweepBenachrichtigungSchema = z.object({
  registrierung_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  team: z.string(),
  vorname: z.string(),
  email: z.string(),
});
export type FLRegistrierungSweepBenachrichtigung = z.infer<typeof FLRegistrierungSweepBenachrichtigungSchema>;

/** One season's clocks, all of them run before this answers: what comes back is what to mail and what was erased. */
export const FLRegistrierungSweepResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  erinnerungen: z.array(FLRegistrierungSweepErinnerungSchema),
  benachrichtigt: z.array(FLRegistrierungSweepBenachrichtigungSchema),
  geloescht_unbestaetigt: z.int().nonnegative(),
  geloescht_ohne_entscheidung: z.int().nonnegative(),
  geloescht_abgelehnt: z.int().nonnegative(),
  redigierte_aktionen: z.int().nonnegative(),
});
export type FLRegistrierungSweepResponse = z.infer<typeof FLRegistrierungSweepResponseSchema>;
