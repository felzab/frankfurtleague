import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH } from "@/features/spiele/constants";
import { FLSpielOrtFieldPublicSchema } from "@/features/spiele/schemas";
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

/**
 * Restated from `fl_backend/app/api/spielbestaetigungen/schemas.py :: ANFRAGEN_LISTED_PER_PASS` and held to the
 * `maxItems` the stamp's payload publishes by `fl_frontend/src/core/payloadBounds.test.ts`.
 */
const ANFRAGEN_LISTED_PER_PASS = 84;

export const FLSpielbestaetigungAntwortArtSchema = z.enum(["zugesagt", "abgelehnt"], {
  error: "Bitte sag zu oder schlag einen anderen Termin vor.",
});
export type FLSpielbestaetigungAntwortArt = z.infer<typeof FLSpielbestaetigungAntwortArtSchema>;

/**
 * What a reopened link shows; `unlesbar`, a read that failed, is the page's own and no value of this set. `vorschlag`
 * is a link still answerable while the other club's decline proposes another date for the same Ansetzung.
 */
export const FLSpielbestaetigungZustandSchema = z.enum([
  "gueltig",
  "vorschlag",
  "zugesagt",
  "abgelehnt",
  "abgelaufen",
  "ungueltig",
  "gesperrt",
]);
export type FLSpielbestaetigungZustand = z.infer<typeof FLSpielbestaetigungZustandSchema>;

/** Which side of the fixture the reader's club plays, so the page can name the opponent. */
export const FLSpielbestaetigungSeiteSchema = z.enum(["team1", "team2"]);
export type FLSpielbestaetigungSeite = z.infer<typeof FLSpielbestaetigungSeiteSchema>;

/** A date and an hour without a ground: a club's proposal, and the slot a moved fixture left. */
export const FLSpielbestaetigungTerminSchema = z.object({
  datum: CustomDateStringSchema,
  uhrzeit: CustomTimeStringSchema,
});
export type FLSpielbestaetigungTermin = z.infer<typeof FLSpielbestaetigungTerminSchema>;

/** The seat whose link was pressed, never the person: a role is what a page may say about who answered. */
export const FLSpielbestaetigungVonKontaktSchema = z.object({
  art: z.literal("kontakt"),
  rolle: FLKontaktRolleSchema,
});

/** An administrator's settlement, naming nobody. */
export const FLSpielbestaetigungVonAdminSchema = z.object({
  art: z.literal("admin"),
});

export const FLSpielbestaetigungVonSchiedsrichterSchema = z.object({
  art: z.literal("schiedsrichter"),
});

export const FLSpielbestaetigungVonSchema = z.discriminatedUnion("art", [
  FLSpielbestaetigungVonKontaktSchema,
  FLSpielbestaetigungVonAdminSchema,
  FLSpielbestaetigungVonSchiedsrichterSchema,
]);
export type FLSpielbestaetigungVon = z.infer<typeof FLSpielbestaetigungVonSchema>;

/** The fixture as it stands now, as a page or a message states it. */
export const FLSpielbestaetigungAnsichtAnsetzungSchema = z.object({
  team1_name: z.string(),
  team2_name: z.string(),
  datum: CustomDateStringSchema,
  uhrzeit: CustomTimeStringSchema,
  spielort: FLSpielOrtFieldPublicSchema.nullable(),
});
export type FLSpielbestaetigungAnsichtAnsetzung = z.infer<typeof FLSpielbestaetigungAnsichtAnsetzungSchema>;

/** The view's payload: the token, in a body and never in a query string. */
export const FLSpielbestaetigungAnsichtPayloadSchema = z.object({
  token: bestaetigungToken,
});
export type FLSpielbestaetigungAnsichtPayload = z.infer<typeof FLSpielbestaetigungAnsichtPayloadSchema>;

/**
 * What one link's page renders, filled in every state and naming nobody (`READ-ANSETZUNG-001`). A spent state is
 * narrowed to `zustand` before the page reads it.
 */
export const FLSpielbestaetigungAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  zustand: FLSpielbestaetigungZustandSchema,
  seite: FLSpielbestaetigungSeiteSchema,
  ansetzung: FLSpielbestaetigungAnsichtAnsetzungSchema,
  frist: CustomDateStringSchema,
  // The other club's proposal, on the `vorschlag` state alone; null in every other state, `abgelehnt` included.
  vorschlag: FLSpielbestaetigungTerminSchema.nullable(),
  // Non-null exactly on `zugesagt` and `abgelehnt`.
  beantwortet_von: FLSpielbestaetigungVonSchema.nullable(),
});
export type FLSpielbestaetigungAnsichtResponse = z.infer<typeof FLSpielbestaetigungAnsichtResponseSchema>;

export const FLSpielbestaetigungVorschlagPayloadSchema = FLSpielbestaetigungTerminSchema;
export type FLSpielbestaetigungVorschlagPayload = z.infer<typeof FLSpielbestaetigungVorschlagPayloadSchema>;

/**
 * One club's answer. Proposal and reason are required keys, null where unused, as the endpoint requires: a decline
 * proposes a date, an acceptance carries neither. An empty reason counts as none, as the endpoint stores it.
 */
export const FLSpielbestaetigungAntwortPayloadSchema = z
  .object({
    token: bestaetigungToken,
    antwort: FLSpielbestaetigungAntwortArtSchema,
    vorschlag: FLSpielbestaetigungVorschlagPayloadSchema.nullable(),
    begruendung: einzeiligerName(
      z
        .string()
        .trim()
        .max(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH, {
          error: `Die Begründung darf höchstens ${String(SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH)} Zeichen lang sein.`,
        }),
      "Die Begründung",
    ).nullable(),
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

/**
 * What the answer recorded; no receipt is mailed. Its `vorschlag` is the answering club's own proposal, which no state
 * of the view serves, so the receipt reads it from here and never from a re-read.
 */
export const FLSpielbestaetigungAntwortResponseSchema = BaseAPIResponseSchema.extend({
  zustand: FLSpielbestaetigungAntwortArtSchema,
  beantwortet_von: FLSpielbestaetigungVonSchema,
  vorschlag: FLSpielbestaetigungTerminSchema.nullable(),
});
export type FLSpielbestaetigungAntwortResponse = z.infer<typeof FLSpielbestaetigungAntwortResponseSchema>;

/** The `active` seasons a pass visits, and the newest day a pass ran over any of them. */
export const FLSpielbestaetigungSweepSaisonsResponseSchema = BaseAPIResponseSchema.extend({
  saison_ids: z.array(z.string()),
  spiel_sweep_gelaufen_am: CustomDateStringSchema.nullable(),
});
export type FLSpielbestaetigungSweepSaisonsResponse = z.infer<typeof FLSpielbestaetigungSweepSaisonsResponseSchema>;

/** One LINK and its mailbox; the RAW token lives in this response and the message alone. */
export const FLSpielbestaetigungSweepLinkSchema = z.object({
  address: z.string(),
  rollen: z.array(FLKontaktRolleSchema),
  token: z.string(),
});
export type FLSpielbestaetigungSweepLink = z.infer<typeof FLSpielbestaetigungSweepLinkSchema>;

/** One team row's request or reminder: the fixture, the stored deadline, and every link due a message. */
export const FLSpielbestaetigungSweepAnfrageSchema = z.object({
  spielbestaetigung_id: CustomObjectIdStringSchema,
  spiel_id: CustomObjectIdStringSchema,
  seite: FLSpielbestaetigungSeiteSchema,
  ansetzung: FLSpielbestaetigungAnsichtAnsetzungSchema,
  frist: CustomDateStringSchema,
  links: z.array(FLSpielbestaetigungSweepLinkSchema),
});
export type FLSpielbestaetigungSweepAnfrage = z.infer<typeof FLSpielbestaetigungSweepAnfrageSchema>;

/** A referee row just minted: the referee is told to the panel, with no token. */
export const FLSpielbestaetigungSweepEinteilungSchema = z.object({
  spielbestaetigung_id: CustomObjectIdStringSchema,
  spiel_id: CustomObjectIdStringSchema,
  ansetzung: FLSpielbestaetigungAnsichtAnsetzungSchema,
  address: z.string(),
});
export type FLSpielbestaetigungSweepEinteilung = z.infer<typeof FLSpielbestaetigungSweepEinteilungSchema>;

/** A mailbox told something without a link. */
export const FLSpielbestaetigungSweepEmpfaengerSchema = z.object({
  address: z.string(),
  rollen: z.array(FLKontaktRolleSchema),
});
export type FLSpielbestaetigungSweepEmpfaenger = z.infer<typeof FLSpielbestaetigungSweepEmpfaengerSchema>;

/** A team row a move closed, so a link in its mailboxes is known void before the fresh request arrives. */
export const FLSpielbestaetigungSweepNeueAnsetzungSchema = z.object({
  spielbestaetigung_id: CustomObjectIdStringSchema,
  spiel_id: CustomObjectIdStringSchema,
  team1_name: z.string(),
  team2_name: z.string(),
  // The slot the row was about; the fixture's new one may be undated.
  alt: FLSpielbestaetigungTerminSchema,
  empfaenger: z.array(FLSpielbestaetigungSweepEmpfaengerSchema),
});
export type FLSpielbestaetigungSweepNeueAnsetzung = z.infer<typeof FLSpielbestaetigungSweepNeueAnsetzungSchema>;

/** The same for a referee row: one address and no seat, its message riding a lane that records none. */
export const FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzungSchema = z.object({
  spielbestaetigung_id: CustomObjectIdStringSchema,
  spiel_id: CustomObjectIdStringSchema,
  team1_name: z.string(),
  team2_name: z.string(),
  alt: FLSpielbestaetigungTerminSchema,
  address: z.string(),
});
export type FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzung = z.infer<typeof FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzungSchema>;

/** One season's pass: the requests still to stamp, the reminders already stamped, and the void notices. */
export const FLSpielbestaetigungSweepResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  anfragen: z.array(FLSpielbestaetigungSweepAnfrageSchema),
  erinnerungen: z.array(FLSpielbestaetigungSweepAnfrageSchema),
  einteilungen: z.array(FLSpielbestaetigungSweepEinteilungSchema),
  neue_ansetzungen: z.array(FLSpielbestaetigungSweepNeueAnsetzungSchema),
  schiedsrichter_neue_ansetzungen: z.array(FLSpielbestaetigungSweepSchiedsrichterNeueAnsetzungSchema),
  geschlossen: z.int().nonnegative(),
  fehlgeschlagen: z.int().nonnegative(),
});
export type FLSpielbestaetigungSweepResponse = z.infer<typeof FLSpielbestaetigungSweepResponseSchema>;

/**
 * Which rows' first messages went. Only a row already stamped is skipped: one answered or closed since is stamped all
 * the same, since a row closed for a move is told of the new date only once stamped.
 */
export const FLSpielbestaetigungSweepAngefragtPayloadSchema = z.object({
  spielbestaetigung_ids: z.array(CustomObjectIdStringSchema).max(ANFRAGEN_LISTED_PER_PASS),
});
export type FLSpielbestaetigungSweepAngefragtPayload = z.infer<typeof FLSpielbestaetigungSweepAngefragtPayloadSchema>;

export const FLSpielbestaetigungSweepAngefragtResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  angefragt: z.int().nonnegative(),
  fehlgeschlagen: z.int().nonnegative(),
});
export type FLSpielbestaetigungSweepAngefragtResponse = z.infer<typeof FLSpielbestaetigungSweepAngefragtResponseSchema>;
