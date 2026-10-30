import z from "zod";

import { FLEinwilligungUmfang } from "@/core/generated/client/types";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { FLSpielerKontoEinwilligungPayloadSchema, LinkAntwortTextVersionSchema } from "@/features/spieler/schemas";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, FLKontaktPayloadSchema, PersonNameSchema } from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import { alterAusserhalb } from "./constants";

import type { FLKontakt } from "@/core/generated/client/types";

// A whole name held to the ceiling one part of any other person's name takes: one number, and one
// sentence, on every form.
const schiedsrichterName = PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG });

// Redesign: goes with its last importer.
export const FLPostSchiedsrichterPayloadSchema = z.object({
  name: schiedsrichterName,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPostSchiedsrichterPayload = z.infer<typeof FLPostSchiedsrichterPayloadSchema>;

// Redesign: goes with its last importer.
export const FLPatchSchiedsrichterPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: schiedsrichterName,
  default_payment: z.int({ error: "Bitte gib ein Standard-Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
  kontakt: FLKontaktPayloadSchema,
  schule: z.string().nullable(),
});
export type FLPatchSchiedsrichterPayload = z.infer<typeof FLPatchSchiedsrichterPayloadSchema>;

/**
 * Whether a row holds an address rather than none: a surface reading the bare value files an emptied
 * one as reached.
 */
export const hatAdresse = (email: string | null): email is string => email !== null && email.trim() !== "";

// Redesign: goes with its last importer.
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

// Redesign: goes with its last importer.
/** The retire and its reactivate: an id in the path, no request body. */
export const FLSchiedsrichterKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterKeyPayload = z.infer<typeof FLSchiedsrichterKeyPayloadSchema>;

// Redesign: goes with its last importer.
/** The re-send's whole argument: the id in the path, no request body. Its own schema: a shared payload lets a caller reach the mint while reading as another write. */
export const FLSchiedsrichterEinladenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSchiedsrichterEinladenPayload = z.infer<typeof FLSchiedsrichterEinladenPayloadSchema>;

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

// Redesign: goes with its last importer.
/**
 * The publication answer. A slug rather than a boolean, because it is stored as one: a switch here
 * and a scope in the record would leave the page and the row disagreeing about what „intern“ means.
 */
// The message an UNANSWERED control raises as well as a drifted one: nothing preselects this choice.
const FLSchiedsrichterUmfangSchema = z.enum(FLEinwilligungUmfang, {
  error: "Bitte wähle aus, was im Spielplan stehen darf.",
});

// Redesign: goes with its last importer.
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

// Redesign: goes with its last importer.
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

// Redesign: goes with its last importer.
/** The pupil's payload, as the backend publishes one declaration under two names: the two writes cannot drift. */
export const FLSchiedsrichterKontoEinwilligungPayloadSchema = FLSpielerKontoEinwilligungPayloadSchema;
