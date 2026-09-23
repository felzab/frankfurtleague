import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { FLBewerbungZustellungSchema } from "@/features/bewerbungen/schemas";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { FLEinwilligungSchema } from "@/features/spieler/schemas";
import { EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH } from "@/features/teams/constants";
import {
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  FLKontaktPayloadSchema,
  FLKontaktSchema,
  isPlaceholderAddress,
  PersonNameSchema,
} from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import { alterAusserhalb } from "./constants";

import type { FLKontakt } from "@/shared/schemas";

export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: PersonNameSchema,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

export const FLPatchSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: PersonNameSchema,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPatchSchiedsrichterPayload = z.infer<typeof FLPatchSchiedsrichterPayloadSchema>;

/**
 * Whether a row holds an address rather than none or the placeholder a row without one is given, as
 * a surface shows the row and files it: a surface reading the bare value files the placeholder as reached.
 */
// Never the write rule below: a row stored before the address rule fails it, yet holds a real
// address an administrator has to see in order to replace it.
export const hatAdresse = (email: string | null): email is string => email !== null && email.trim() !== "" && !isPlaceholderAddress(email);

/**
 * Whether a stored address passes the payload's own rule: the editor's question alone, asked for whether
 * an undo may write it back and whether its panel offers the re-send.
 */
export const bestehtSchreibregel = (email: string | null): boolean => FLKontaktPayloadSchema.shape.email.safeParse(email).success;

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
 * The ANONYMISATION's whole argument: the id in the path, no request body. Its own schema, not the
 * reversible pair's key above — a shared payload would let a caller reach the deletion while reading
 * as a retirement.
 */
export const FLAnonymiseSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLAnonymiseSchiedsrichterPayload = z.infer<typeof FLAnonymiseSchiedsrichterPayloadSchema>;

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
});
export type FLSchiedsrichter = z.infer<typeof FLSchiedsrichterSchema>;

export const FLSchiedsrichterListResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: z.array(FLSchiedsrichterSchema),
});
export type FLSchiedsrichterListResponse = z.infer<typeof FLSchiedsrichterListResponseSchema>;

export const FLSchiedsrichterSingleResponseSchema = BaseAPIResponseSchema.extend({
  schiedsrichter: FLSchiedsrichterSchema,
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

/** The re-send's whole argument: the id in the path, no request body. Its own schema for `FLAnonymiseSchiedsrichterPayloadSchema`'s reason. */
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
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link noch einmal aus Deiner E-Mail.";

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
 * What a link is told before any press: a first name, the link's standing, the wording's label and
 * the floor. The surname never travels, so a leaked link learns no name to look anything up against.
 */
export const FLSchiedsrichterBestaetigungAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  // The link's own standing, answered rather than refused: a spent or lapsed link stays readable, so
  // only an unknown token has nothing to answer with and reaches the page as a 409.
  zustand: z.enum(["gueltig", "bestaetigt", "abgelaufen"]),
  // Null on a row a hand-write left nameless, which is why the page names nobody outside `gueltig`.
  vorname: z.string().nullable(),
  text_version: z.string().nullable(),
  // The floor this person has to reach, over the wire rather than retyped here: a constant of this
  // side's own would be a second number nothing compares.
  mindestalter: z.number().int(),
  // The age the media switch is offered from, over the wire for `mindestalter`'s reason.
  medien_mindestalter: z.number().int(),
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
  text_version: z
    .string()
    .trim()
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
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
  vorname: z.string().nullable(),
  umfang: FLSchiedsrichterUmfangSchema,
  medien: z.boolean(),
  bestaetigt_am: CustomDateStringSchema,
});
export type FLSchiedsrichterBestaetigungResponse = z.infer<typeof FLSchiedsrichterBestaetigungResponseSchema>;
