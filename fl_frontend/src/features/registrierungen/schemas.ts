// Redesign: goes with its last importer.
import z from "zod";

import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
// The application's own derivation, not a copy of it: the two flows bound a birthdate by the same
// two numbers, and a second span here would refuse a day the endpoint takes.
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import {
  FLPostSaisonSpielerPayloadSchema,
  FLSpielerPositionSchema,
  FLSpielerStufeSchema,
  LinkAntwortTextVersionSchema,
} from "@/features/spieler/schemas";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, KontaktEmailSchema, PersonNameSchema } from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import { alterAusserhalb, EINWILLIGUNG_UMFANG_OPTIONS } from "./constants";

import type { FLRegistrierungBestaetigungAnsichtResponseSeite } from "@/core/generated/client/types";

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link erneut.";

/**
 * Both of this slice's tokens are minted by `fl_backend/app/api/bewerbungen/services.py :: mint_token`,
 * so the application's ceiling bounds them. One sentence for the missing token and the over-long one, a
 * visitor having typed neither.
 */
const registrierungToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

/**
 * One pupil's registration.
 *
 * The three optional fields are nullable rather than omitted, as the squad's own payload requires: an
 * absent key and a chosen „keine Angabe" read alike otherwise.
 */
export const FLPostRegistrierungPayloadSchema = z.object({
  token: registrierungToken,
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  email: KontaktEmailSchema,
  position: FLSpielerPositionSchema.nullable(),
  // The squad payload's own field, never a second regex: a pupil types the number an administrator
  // later edits, and two spellings are how one tier starts refusing what the other takes.
  nummer: FLPostSaisonSpielerPayloadSchema.shape.nummer,
  stufe: FLSpielerStufeSchema.nullable(),
});

// The message an UNANSWERED control raises as well as a drifted one: nothing preselects this choice.
const FLEinwilligungUmfangSchema = z.enum(EINWILLIGUNG_UMFANG_OPTIONS, {
  error: "Bitte wähle aus, was auf der Website stehen darf.",
});

// The endpoint refuses the age and the handler lands that refusal on the date field, so a floor
// retyped here would be a second copy nothing compares.

/**
 * One person, one press, one token spent. **It bounds no age**: the floor arrives with the link's own read.
 *
 * Null where the page asks nothing: both choices and the date on the returning pupil's page
 * (`REQ-REGISTRIERUNG-017`).
 */
export const FLRegistrierungBestaetigungPayloadSchema = z.object({
  token: registrierungToken,
  geburtsdatum: CustomDateStringSchema.nullable(),
  umfang: FLEinwilligungUmfangSchema.nullable(),
  // Separately answered from `umfang`, and the endpoint stores both: one press carries two
  // consents, and a media permission folded into the scope would be one nobody gave on its own.
  medien: z.boolean().nullable(),
  // The version this page rendered, never the one a later reader would be shown: the record has
  // to cite the words the confirming person read.
  text_version: LinkAntwortTextVersionSchema,
});

/**
 * The page's own, built at the floor the link answered: the date is judged against the German day
 * here as the endpoint judges it, so both tiers refuse the same two numbers on the same day.
 */
export function buildRegistrierungBestaetigungPayloadSchema(mindestalter: number, seite: FLRegistrierungBestaetigungAnsichtResponseSeite) {
  // The new pupil's three tightened past the payload's null: an unanswered scope is a field error before any press.
  return seite === "bestaetigung_spieler"
    ? FLRegistrierungBestaetigungPayloadSchema.extend({
        geburtsdatum: CustomDateStringSchema.refine(
          (datum) => {
            const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);

            return datum >= frueheste && datum <= spaeteste;
          },
          { error: alterAusserhalb(mindestalter) },
        ),
        umfang: FLEinwilligungUmfangSchema,
        medien: z.boolean(),
      })
    : FLRegistrierungBestaetigungPayloadSchema.extend({ geburtsdatum: z.null(), umfang: z.null(), medien: z.null() });
}

/**
 * Whom the registration is admitted into: `null` makes a new person or takes the one its address
 * resolves to under the same name, an id is the representative's yes to that person where its details differ.
 */
export const FLRegistrierungAufnehmenPayloadSchema = z.object({
  spieler_id: CustomObjectIdStringSchema.nullable(),
});

/** A fixed choice and never free text: the decline note picks its sentence from it, and nothing a team types reaches the pupil. */
const FLRegistrierungAblehnungsgrundSchema = z.enum(["andere_person"], { error: "Diesen Grund kennen wir nicht. Lade die Seite neu." });

export const FLRegistrierungAblehnenPayloadSchema = z.object({
  grund: FLRegistrierungAblehnungsgrundSchema.nullable(),
});
