import z from "zod";

import { FLSpielbestaetigungAntwortArt } from "@/core/generated/client/types";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH } from "@/features/spiele/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema, einzeiligerName } from "@/shared/schemas";

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link aus Deiner E-Mail erneut.";

/**
 * Mirrors `fl_backend/app/api/spielbestaetigungen/schemas.py :: CustomSpielbestaetigungToken`. One sentence for the
 * missing token and the over-long one: a visitor typed neither, so the repair is the same link opened again.
 */
const bestaetigungToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

const FLSpielbestaetigungAntwortArtSchema = z.enum(FLSpielbestaetigungAntwortArt, {
  error: "Bitte sag zu oder schlag einen anderen Termin vor.",
});

/** A date and an hour without a ground: a club's proposal, and the slot a moved fixture left. */
const FLSpielbestaetigungTerminSchema = z.object({
  datum: CustomDateStringSchema,
  uhrzeit: CustomTimeStringSchema,
});

/** A decline's reason, a club's and a referee's alike: one line, as the endpoint stores it. */
const begruendungText = z
  .string()
  .trim()
  .max(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH, {
    error: `Die Begründung darf höchstens ${String(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH)} Zeichen lang sein.`,
  });
const begruendung = einzeiligerName(begruendungText, "Die Begründung");

// Redesign: goes with its last importer.
/**
 * One club's answer. Proposal and reason are required keys, null where unused, as the endpoint requires: a decline
 * proposes a date, an acceptance carries neither. An empty reason counts as none, as the endpoint stores it.
 */
export const FLSpielbestaetigungAntwortPayloadSchema = z
  .object({
    token: bestaetigungToken,
    antwort: FLSpielbestaetigungAntwortArtSchema,
    vorschlag: FLSpielbestaetigungTerminSchema.nullable(),
    begruendung: begruendung.nullable(),
  })
  .refine((antwort) => antwort.antwort !== "abgelehnt" || antwort.vorschlag !== null, {
    error: "Bitte schlag einen anderen Termin vor.",
    path: ["vorschlag"],
  })
  .refine((antwort) => antwort.antwort !== "zugesagt" || (antwort.vorschlag === null && !antwort.begruendung), {
    error: "Eine Zusage trägt keinen Terminvorschlag und keine Begründung.",
    path: ["antwort"],
  });
export type FLSpielbestaetigungAntwortPayload = z.infer<typeof FLSpielbestaetigungAntwortPayloadSchema>;

// Redesign: goes with its last importer.
/**
 * What a referee's decline form sends its action, which wraps it in the answer's payload: the league needs the
 * reason to book somebody else, so the endpoint takes no decline without one.
 */
export const SchiedsrichterAbsageSchema = z.object({
  begruendung: einzeiligerName(begruendungText.nonempty({ error: "Bitte gib einen Grund für Deine Absage an." }), "Die Begründung"),
});
export type SchiedsrichterAbsage = z.infer<typeof SchiedsrichterAbsageSchema>;

// --- The administrator's settle and discard (`fl_backend/app/api/spielbestaetigungen/admin_router.py`).

// Redesign: goes with its last importer.
/**
 * The settle: a Zusage recorded on the party's behalf, with the reason the league's record of it carries. The reason
 * takes no name check, as a club's own does not, and goes at the season's end.
 */
export const FLSpielbestaetigungEintragenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  begruendung: einzeiligerName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib eine Begründung an." })
      .max(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH, {
        error: `Die Begründung darf höchstens ${String(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH)} Zeichen lang sein.`,
      }),
    "Die Begründung",
  ),
});
export type FLSpielbestaetigungEintragenPayload = z.infer<typeof FLSpielbestaetigungEintragenPayloadSchema>;

// Redesign: goes with its last importer.
export const FLSpielbestaetigungVerwerfenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSpielbestaetigungVerwerfenPayload = z.infer<typeof FLSpielbestaetigungVerwerfenPayloadSchema>;
