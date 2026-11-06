// Redesign: goes with its last importer.
import z from "zod";

import { SEAT_TEXT_VERSIONS } from "@/core/consentWordings";
import { FLKontaktRolle } from "@/core/generated/client/types";
import { LINK_FASSUNG_FEHLT, textVersionsSchema } from "@/features/spieler/schemas";
import { KONTAKT_NAME_MAX_LENGTH, KONTAKT_NAME_ZU_LANG } from "@/features/teams/constants";
import { FLGruppenNamesSchema, FLTrikotFarbeSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, KontaktEmailSchema, PersonNameSchema, PHONE_REGEX } from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import { alterAusserhalb, BEWERBUNG_DECISION_REASON_MAX_LENGTH, BEWERBUNG_MIN_ALTER, BEWERBUNG_TOKEN_MAX_LENGTH } from "./constants";
import { geburtsdatumSpanne } from "./utils";

import type { FLBewerbungEinwilligungDeclined, FLBewerbungEinwilligungGiven } from "@/core/generated/client/types";

/**
 * The acceptance's input. No `saison_id`: the application names its own season, so a payload carrying
 * one could only disagree with it.
 */
export const FLAnnehmenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  // Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment.
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
  shorthand: z.string().nullable(),
  version: z.number(),
});

/**
 * The decline's input. Its own declaration and never shared with the acceptance's: the two are not
 * inverses, and a payload reaching both would let a value typed for one arrive at the other.
 */
export const FLAblehnenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Required and non-empty: it is stored on the application AND sent to the people who applied, so a
  // decline with nothing to say is one nobody can act on.
  decision_reason: z
    .string()
    // Trimmed before it is measured, and the trimmed value is what the write carries: „   “ is an
    // empty reason, and a decline is stored and mailed once with no way back.
    .trim()
    .nonempty({ error: "Bitte gib einen Grund für die Absage an." })
    .max(BEWERBUNG_DECISION_REASON_MAX_LENGTH, {
      error: `Der Grund darf höchstens ${String(BEWERBUNG_DECISION_REASON_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  version: z.number(),
});

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link aus Deiner E-Mail erneut.";

/** The link's token. One sentence for the missing token and the over-long one: a visitor typed neither, so the repair is the same link opened again. */
const einwilligungToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

/** The wire names a seat by this closed set; an input naming another is refused before it is sent. */
export const FLKontaktRolleSchema = z.enum(FLKontaktRolle, {
  error: "Diese Rolle gibt es in einer Bewerbung nicht.",
});

/**
 * One endpoint for both answers, told apart by `antwort` as the backend's union is: one person, one
 * press, one token spent. A Widerspruch carries the token alone, its seat storing no person. A
 * confirmation's date is judged against the German day here as the endpoint judges it, so both tiers
 * refuse the same two numbers on the same day.
 */
export const buildEinwilligungAntwortPayloadSchema = (mindestalter: number) =>
  z.discriminatedUnion(
    "answer",
    [
      z.object({
        answer: z.literal("given" satisfies FLBewerbungEinwilligungGiven["answer"]),
        token: einwilligungToken,
        // Each stage only once the one before it passed: the empty picker is the missing date, and an age is
        // judged of a real date alone.
        birth_date: z
          .string()
          .min(1, { error: "Bitte gib Dein Geburtsdatum ein." })
          .pipe(CustomDateStringSchema)
          .pipe(
            z.string().refine(
              (geburtsdatum) => {
                const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);
                return frueheste <= geburtsdatum && geburtsdatum <= spaeteste;
              },
              { error: alterAusserhalb(mindestalter) },
            ),
          ),
        whatsapp: z.boolean(),
        // Never optional, as `whatsapp` is not: a page that dropped the switch is refused rather than
        // read as a no.
        media: z.boolean(),
        // The wordings this page rendered beside the two switches, which the seat's evidence cites.
        text_versions: textVersionsSchema(SEAT_TEXT_VERSIONS, LINK_FASSUNG_FEHLT),
      }),
      z.object({ answer: z.literal("declined" satisfies FLBewerbungEinwilligungDeclined["answer"]), token: einwilligungToken }),
    ],
    // No control offers another, so a value outside the pair is a drifted client rather than a mistyped
    // answer, and the repair is the reload rather than a choice.
    { error: "Diese Antwort kennen wir nicht. Lade die Seite neu." },
  );

/**
 * The league's floor, which every seat's person clears:
 * `fl_frontend/src/app/api/bestaetigung/kontakt/route.ts` parses a body carrying the token alone, so
 * the seat's own floor is the page's to offer and the endpoint's to refuse.
 */
export const FLBewerbungEinwilligungAnswerPayloadSchema = buildEinwilligungAntwortPayloadSchema(BEWERBUNG_MIN_ALTER);

/** Which application and which of its seats. Both travel in the path, so the request carries no body at all. */
export const FLEinwilligungErneutPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
});

/**
 * The one field of a submitted application an administrator may rewrite. `id` and `rolle` travel in
 * the path, as the re-send's do.
 */
export const FLBewerbungKontaktEmailPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
  email: KontaktEmailSchema,
  version: z.number(),
});

/**
 * The person seated where a contact person stepped out. The four fields are restated rather than taken
 * off the submission's seat: that one carries the Kenntnisnahme, which this person has given nobody.
 */
export const FLBewerbungKontaktSitzPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
  first_name: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  last_name: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  email: KontaktEmailSchema,
  phone: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  version: z.number(),
});
