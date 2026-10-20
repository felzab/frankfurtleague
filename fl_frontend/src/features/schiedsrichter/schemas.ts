import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { MedienMindestalterSchema } from "@/features/konto/einwilligung";
import {
  AdresswechselGrundSchema,
  FLAdresswechselMitteilungSchema,
  FLEinwilligungSchema,
  FLEinwilligungStandSchema,
  FLSpielerAdresswechselAnsichtBisherigSchema,
  FLSpielerAdresswechselAnsichtNeuSchema,
  FLSpielerAdresswechselAnsichtResponseSchema,
  FLSpielerAdresswechselAntwortResponseSchema,
  FLSpielerAdresswechselMintSchema,
  FLSpielerAdresswechselSchema,
  FLSpielerAdresswechselStoppResponseSchema,
  FLSpielerSelbstEinwilligungPayloadSchema,
  LinkAntwortTextVersionSchema,
} from "@/features/spieler/schemas";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import {
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  FLBewerbungZustellungSchema,
  FLKontaktPayloadSchema,
  FLKontaktSchema,
  isPlaceholderAddress,
  KontaktEmailSchema,
  PersonNameSchema,
} from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import { alterAusserhalb } from "./constants";

import type { FLKontakt } from "@/shared/schemas";

// A whole name held to the ceiling one part of any other person's name takes: one number, and one
// sentence, on every form.
const schiedsrichterName = PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG });

export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: schiedsrichterName,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

export const FLPatchSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: schiedsrichterName,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPatchSchiedsrichterPayload = z.infer<typeof FLPatchSchiedsrichterPayloadSchema>;

/**
 * Whether a row holds an address rather than none or the placeholder a row without one is given: a
 * surface reading the bare value files the placeholder as reached, and an undo would write it back.
 */
export const hatAdresse = (email: string | null): email is string => email !== null && email.trim() !== "" && !isPlaceholderAddress(email);

/**
 * Widened at each field whose emptied box holds `null`, which the schema above refuses at the submit. `Omit`, not an intersection: `T & { default_payment: number | null }` stays
 * assignable to `T`, hiding the `null` from every caller.
 */
export type FLSchiedsrichterPayloadDraft<T extends { default_payment: number; kontakt: { email: string } }> = Omit<
  T,
  "default_payment" | "kontakt"
> & {
  default_payment: number | null;
  kontakt: FLKontakt;
};

/** The retire and its reactivate: an id in the path, no request body. */
export const FLSchiedsrichterKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterKeyPayload = z.infer<typeof FLSchiedsrichterKeyPayloadSchema>;

/**
 * Mirrors the referee's link bookkeeping. No `token_hash`: the credential is written as a raw
 * document key and read only by the confirming query, so no read model carries it and neither may
 * this. No `abgelehnt_am`: this page offers no decline.
 */
export const FLSchiedsrichterBestaetigungSchema = z.object({
  verschickt_am: CustomDateStringSchema,
  // Always null at this commit: nothing reminds a referee. Rendered so the editor shows the state
  // rather than the absence of a field, and a reminder that arrives has a home already.
  erinnert_am: CustomDateStringSchema.nullable(),
  frist: CustomDateStringSchema,
  // Null where no message has been accepted for this row: an absent state is "nothing is known",
  // never "delivered".
  zustellung: FLBewerbungZustellungSchema.nullable(),
});
export type FLSchiedsrichterBestaetigung = z.infer<typeof FLSchiedsrichterBestaetigungSchema>;

/**
 * A freshly minted link, answered ONCE by the endpoint that minted it. The raw token exists here and
 * in the recipient's inbox and nowhere else, so no read model and no log line may carry this shape.
 */
export const FLSchiedsrichterMintSchema = z.object({
  token: z.string(),
  frist: CustomDateStringSchema,
  // The address the mint's own transaction read. Mailing the one a caller read BEFORE the mint sends
  // the credential to a mailbox a rival save has already replaced.
  email: z.string().nonempty(),
});
export type FLSchiedsrichterMint = z.infer<typeof FLSchiedsrichterMintSchema>;

// The pupil's shapes under the referee's names: a change belongs to an address, so both lanes store,
// mint and answer it alike, and each pair is still compared to its own published component.
/** Mirrors a confirmed referee's pending address change. */
export const FLSchiedsrichterAdresswechselSchema = FLSpielerAdresswechselSchema;
export type FLSchiedsrichterAdresswechsel = z.infer<typeof FLSchiedsrichterAdresswechselSchema>;

export const FLSchiedsrichterAdresswechselMintSchema = FLSpielerAdresswechselMintSchema;
export type FLSchiedsrichterAdresswechselMint = z.infer<typeof FLSchiedsrichterAdresswechselMintSchema>;

export const FLSchiedsrichterSchema = z.object({
  id: CustomObjectIdStringSchema,

  // Null on a hand-write that left the row nameless, and on the one row the erasure repoints fixtures
  // at. What a reader is shown instead is
  // `fl_frontend/src/features/schiedsrichter/constants.ts :: bookedSchiedsrichterName`.
  name: z.string().nonempty().nullable(),
  schule: z.string().nullable(),
  // The standard fee. A Spiel's embedded `payment` is what was agreed for that match, and changing
  // this never rewrites it.
  default_payment: z.int().nonnegative(),
  kontakt: FLKontaktSchema,
  // The day the referee was retired, null while they officiate. Deactivation goes through
  // DELETE, so it is on no payload.
  inactive_since: CustomDateStringSchema.nullable(),
  // The person's own to enter, on their confirmation page: no admin payload carries it, and the
  // admin tier is the only tier this read is served to.
  geburtsdatum: CustomDateStringSchema.nullable(),
  // The same sub-schema a pupil's record takes, reached across the slice boundary rather than
  // retyped: one shape read by two collections, so a member added on one side reaches both.
  einwilligung: FLEinwilligungSchema.nullable(),
  bestaetigung: FLSchiedsrichterBestaetigungSchema.nullable(),
  // Null unless an administrator moved a confirmed referee's address and its new mailbox has not answered.
  adresswechsel: FLSchiedsrichterAdresswechselSchema.nullable(),
});
export type FLSchiedsrichter = z.infer<typeof FLSchiedsrichterSchema>;

export const FLSchiedsrichterListResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: z.array(FLSchiedsrichterSchema),
});
export type FLSchiedsrichterListResponse = z.infer<typeof FLSchiedsrichterListResponseSchema>;

export const FLSchiedsrichterSingleResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: FLSchiedsrichterSchema,
  // The backend's judgement of each link's deadline today, so the editor reads no day of its own.
  bestaetigung_abgelaufen: z.boolean(),
  adresswechsel_abgelaufen: z.boolean(),
});
export type FLSchiedsrichterSingleResponse = z.infer<typeof FLSchiedsrichterSingleResponseSchema>;

export const FLPostSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
  // Never null, unlike the patch's: the payload requires an address, and entering a referee is the invitation.
  bestaetigung: FLSchiedsrichterMintSchema,
});
export type FLPostSchiedsrichterResponse = z.infer<typeof FLPostSchiedsrichterResponseSchema>;

export const FLPatchSchiedsrichterResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
  // How many fixtures the rename reached. Reported because the fan-out fails silently (`docs/backend/spec.md :: I13`).
  fanned_out_to_spiele: z.int().nonnegative(),
  // Non-null only where the correction moved an UNCONFIRMED referee's address: the old link was
  // posted to a mailbox nobody reads, and leaving it live is a credential in the wrong inbox.
  bestaetigung: FLSchiedsrichterMintSchema.nullable(),
});
export type FLPatchSchiedsrichterResponse = z.infer<typeof FLPatchSchiedsrichterResponseSchema>;

/**
 * Mirrors `FLSchiedsrichterAdresswechselPayload`: an administrator's start of a confirmed referee's
 * change, the pupil's twin. The save refuses to move that address (`REQ-SCHIEDSRICHTER-011`).
 */
export const FLSchiedsrichterAdresswechselPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  email: KontaktEmailSchema,
  grund: AdresswechselGrundSchema.nullable(),
});
export type FLSchiedsrichterAdresswechselPayload = z.infer<typeof FLSchiedsrichterAdresswechselPayloadSchema>;

/** The address link's re-send and its discard: the id in the path, no request body. One schema per control: a shared payload lets a caller reach one write while reading as another. */
export const FLSchiedsrichterAdresswechselEinladenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterAdresswechselEinladenPayload = z.infer<typeof FLSchiedsrichterAdresswechselEinladenPayloadSchema>;

export const FLSchiedsrichterAdresswechselVerwerfenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterAdresswechselVerwerfenPayload = z.infer<typeof FLSchiedsrichterAdresswechselVerwerfenPayloadSchema>;

/** The address link's re-send echo. Never null: a referee holding no pending change is answered 404. */
export const FLSchiedsrichterAdresswechselMintResponseSchema = BaseAPIResponseSchema.extend({
  adresswechsel: FLSchiedsrichterAdresswechselMintSchema,
});
export type FLSchiedsrichterAdresswechselMintResponse = z.infer<typeof FLSchiedsrichterAdresswechselMintResponseSchema>;

/** The re-send's whole argument: the id in the path, no request body. Its own schema: a shared payload lets a caller reach the mint while reading as another write. */
export const FLSchiedsrichterEinladenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterEinladenPayload = z.infer<typeof FLSchiedsrichterEinladenPayloadSchema>;

/** The re-send's echo. Never null, as the create's is and unlike the patch's: this endpoint exists to mint, so a row it cannot mint for is refused. */
export const FLSchiedsrichterMintResponseSchema = BaseAPIResponseSchema.extend({
  bestaetigung: FLSchiedsrichterMintSchema,
});
export type FLSchiedsrichterMintResponse = z.infer<typeof FLSchiedsrichterMintResponseSchema>;

/**
 * What the retire and the erasure echo: one model for the two. The erasure's own row is deleted by
 * then, so what it echoes is the GHOST — never the person, and never a state.
 */
export const FLSchiedsrichterWriteResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
});
export type FLSchiedsrichterWriteResponse = z.infer<typeof FLSchiedsrichterWriteResponseSchema>;

/** The reactivation's own echo: of the pair, only coming back can mint, an unanswered referee being asked on return. */
export const FLSchiedsrichterReactivateResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLSchiedsrichterSchema,
  bestaetigung: FLSchiedsrichterMintSchema.nullable(),
});
export type FLSchiedsrichterReactivateResponse = z.infer<typeof FLSchiedsrichterReactivateResponseSchema>;

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link aus Deiner E-Mail erneut.";

/**
 * Both public payloads read their token from here. One sentence for the missing token and the
 * over-long one: a visitor typed neither, so the repair is the same link opened again.
 */
const bestaetigungToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

/**
 * The publication answer. A slug rather than a boolean, because it is stored as one: a switch here
 * and a scope in the record would leave the page and the row disagreeing about what „intern“ means.
 */
// The message an UNANSWERED control raises as well as a drifted one: nothing preselects this choice.
export const FLSchiedsrichterUmfangSchema = z.enum(["kader_oeffentlich", "intern"], {
  error: "Bitte wähle aus, was im Spielplan stehen darf.",
});
export type FLSchiedsrichterUmfang = z.infer<typeof FLSchiedsrichterUmfangSchema>;

/**
 * The read's payload: the token, in a body and never in a query string. The token is the credential,
 * and a second URL carrying it is a second line the edge has to redact.
 */
export const FLSchiedsrichterBestaetigungAnsichtPayloadSchema = z.object({
  token: bestaetigungToken,
});
export type FLSchiedsrichterBestaetigungAnsichtPayload = z.infer<typeof FLSchiedsrichterBestaetigungAnsichtPayloadSchema>;

/**
 * What a link is told before any press: the link's standing and the floor. No
 * name travels: the link went to an address nobody has confirmed (`READ-REFEREE-002`).
 */
export const FLSchiedsrichterBestaetigungAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  // The link's own standing, answered rather than refused: a spent or lapsed link stays readable, so
  // only an unknown token has nothing to answer with and reaches the page as a 409.
  zustand: z.enum(["gueltig", "bestaetigt", "abgelaufen", "gesperrt"]),
  // The floor this person has to reach, over the wire rather than retyped here: a constant of this
  // side's own would be a second number nothing compares.
  mindestalter: z.number().int(),
  // The age the media switch is offered from, over the wire for `mindestalter`'s reason.
  medien_mindestalter: MedienMindestalterSchema,
  frist: CustomDateStringSchema,
});
export type FLSchiedsrichterBestaetigungAnsichtResponse = z.infer<typeof FLSchiedsrichterBestaetigungAnsichtResponseSchema>;

/**
 * **It bounds no age**: the floor arrives with the link's own read, and a number retyped here would
 * be a second copy nothing compares. The endpoint refuses the age; the handler lands that refusal on
 * the date field.
 */
export const FLSchiedsrichterBestaetigungPayloadSchema = z.object({
  token: bestaetigungToken,
  geburtsdatum: CustomDateStringSchema,
  umfang: FLSchiedsrichterUmfangSchema,
  // Never optional: the record stores the key either way, so an omitted one would store the model's
  // default in place of the person's answer.
  medien: z.boolean(),
  // The version this page rendered, never one a browser chose: the record has to cite the words the
  // confirming person read.
  text_version: LinkAntwortTextVersionSchema,
});
export type FLSchiedsrichterBestaetigungPayload = z.infer<typeof FLSchiedsrichterBestaetigungPayloadSchema>;

/**
 * The page's own, built at the floor the link answered: the date is judged against the German day
 * here as the endpoint judges it, so both tiers refuse the same two numbers on the same day.
 */
export const buildSchiedsrichterBestaetigungPayloadSchema = (mindestalter: number) =>
  FLSchiedsrichterBestaetigungPayloadSchema.extend({
    geburtsdatum: CustomDateStringSchema.refine(
      (datum) => {
        const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

        return datum >= frueheste && datum <= spaeteste;
      },
      { error: alterAusserhalb(mindestalter) },
    ),
  });

/** The write's echo: what was stored for this person, and nothing they did not just send. */
export const FLSchiedsrichterBestaetigungResponseSchema = BaseAPIResponseSchema.extend({
  umfang: FLSchiedsrichterUmfangSchema,
  medien: z.boolean(),
  bestaetigt_am: CustomDateStringSchema,
});
export type FLSchiedsrichterBestaetigungResponse = z.infer<typeof FLSchiedsrichterBestaetigungResponseSchema>;

/** The address link's read, its token in a body for the consent link's reason. */
export const FLSchiedsrichterAdresswechselAnsichtPayloadSchema = z.object({
  token: bestaetigungToken,
});
export type FLSchiedsrichterAdresswechselAnsichtPayload = z.infer<typeof FLSchiedsrichterAdresswechselAnsichtPayloadSchema>;

/** What an address link is told before any press, the pupil's page's answer (`READ-REFEREE-003`). */
export const FLSchiedsrichterAdresswechselAnsichtNeuSchema = FLSpielerAdresswechselAnsichtNeuSchema;
export type FLSchiedsrichterAdresswechselAnsichtNeu = z.infer<typeof FLSchiedsrichterAdresswechselAnsichtNeuSchema>;
export const FLSchiedsrichterAdresswechselAnsichtBisherigSchema = FLSpielerAdresswechselAnsichtBisherigSchema;
export type FLSchiedsrichterAdresswechselAnsichtBisherig = z.infer<typeof FLSchiedsrichterAdresswechselAnsichtBisherigSchema>;
export const FLSchiedsrichterAdresswechselAnsichtResponseSchema = FLSpielerAdresswechselAnsichtResponseSchema;
export type FLSchiedsrichterAdresswechselAnsichtResponse = z.infer<typeof FLSchiedsrichterAdresswechselAnsichtResponseSchema>;

/** Whether the mailbox the link reached is the referee's: `bestaetigt` moves the address there, `abgelehnt` discards the change. */
export const FLSchiedsrichterAdresswechselAntwortPayloadSchema = z.object({
  token: bestaetigungToken,
  antwort: z.enum(["bestaetigt", "abgelehnt"], { error: LINK_UNVOLLSTAENDIG }),
});
export type FLSchiedsrichterAdresswechselAntwortPayload = z.infer<typeof FLSchiedsrichterAdresswechselAntwortPayloadSchema>;

export const FLSchiedsrichterAdresswechselAntwortResponseSchema = FLSpielerAdresswechselAntwortResponseSchema;
export type FLSchiedsrichterAdresswechselAntwortResponse = z.infer<typeof FLSchiedsrichterAdresswechselAntwortResponseSchema>;

/** The stop of the address on file, by the token its notice carried. */
export const FLSchiedsrichterAdresswechselStoppPayloadSchema = z.object({
  token: bestaetigungToken,
});
export type FLSchiedsrichterAdresswechselStoppPayload = z.infer<typeof FLSchiedsrichterAdresswechselStoppPayloadSchema>;

export const FLSchiedsrichterAdresswechselStoppResponseSchema = FLSpielerAdresswechselStoppResponseSchema;
export type FLSchiedsrichterAdresswechselStoppResponse = z.infer<typeof FLSchiedsrichterAdresswechselStoppResponseSchema>;

/** Mirrors `FLSchiedsrichterKontext`: the first part of the one stored name, cut as the confirmation page cuts it. */
export const FLSchiedsrichterKontextSchema = z.object({
  vorname: z.string().nullable(),
});
export type FLSchiedsrichterKontext = z.infer<typeof FLSchiedsrichterKontextSchema>;

/**
 * Mirrors `FLSchiedsrichterSelbst`, the person tier's own read of the stored data: no link bookkeeping,
 * which is the administration's, and no consent, which is the account page's entry's.
 */
export const FLSchiedsrichterSelbstSchema = z.object({
  schiedsrichter_id: CustomObjectIdStringSchema,
  name: z.string(),
  schule: z.string().nullable(),
  kontakt: FLKontaktSchema,
  // `default_payment`, served because the referee's confirmation page lists the fee among what is stored.
  honorar: z.number().int(),
  geburtsdatum: CustomDateStringSchema.nullable(),
});
export type FLSchiedsrichterSelbst = z.infer<typeof FLSchiedsrichterSelbstSchema>;

export const FLSchiedsrichterSelbstResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: z.array(FLSchiedsrichterSelbstSchema),
});
export type FLSchiedsrichterSelbstResponse = z.infer<typeof FLSchiedsrichterSelbstResponseSchema>;

/** The pupil's payload, as the backend publishes one declaration under two names: the two writes cannot drift. */
export const FLSchiedsrichterSelbstEinwilligungPayloadSchema = FLSpielerSelbstEinwilligungPayloadSchema;
export type FLSchiedsrichterSelbstEinwilligungPayload = z.infer<typeof FLSchiedsrichterSelbstEinwilligungPayloadSchema>;

export const FLSchiedsrichterSelbstEinwilligungResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter_id: CustomObjectIdStringSchema,
  einwilligung: FLEinwilligungSchema,
  nachweis_stand: FLEinwilligungStandSchema,
});
export type FLSchiedsrichterSelbstEinwilligungResponse = z.infer<typeof FLSchiedsrichterSelbstEinwilligungResponseSchema>;

/**
 * One share of the pending changes lapsed or due. `nach` is where the next call starts, null at the end;
 * `verbleibend` counts the failed too, so it never ends a pass.
 */
export const FLSchiedsrichterAdresswechselSweepResponseSchema = BaseAPIResponseSchema.extend({
  entfernt: z.int().nonnegative(),
  verbleibend: z.int().nonnegative(),
  nach: CustomObjectIdStringSchema.nullable(),
  // Each change this call took effect for, whose replaced address the pass mails its completion notice.
  wirksam: z.array(FLAdresswechselMitteilungSchema),
  // Due changes the judgement at the end of their waiting time refused, removed as a lapse is.
  verworfen: z.int().nonnegative(),
});
export type FLSchiedsrichterAdresswechselSweepResponse = z.infer<typeof FLSchiedsrichterAdresswechselSweepResponseSchema>;
