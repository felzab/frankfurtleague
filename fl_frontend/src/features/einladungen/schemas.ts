import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
// The applications slice declares the width every minted token is bounded by, one mint function
// serving both flows (`fl_backend/app/api/bewerbungen/services.py :: mint_token`); a literal beside
// it is compared by nothing.
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { FLBewerbungZustellungSchema, FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * Which team's invite, in a season. Both ids travel in the PATH on the wire; they are carried here
 * because the action has to know whose invite it is minting.
 */
export const FLEinladungKeyPayloadSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
});
export type FLEinladungKeyPayload = z.infer<typeof FLEinladungKeyPayloadSchema>;

/**
 * **The raw link value is the panel's to hand back**: the store keeps a hash alone, so the mint's
 * own answer is the only place it exists, and a message composed after a reload would carry none.
 */
export const FLEinladungMailPayloadSchema = FLEinladungKeyPayloadSchema.extend({
  einladung_id: CustomObjectIdStringSchema,
  token: z
    .string()
    .trim()
    // German though the panel offers no box for it: a payload refused here reaches the log rather
    // than a field, and `fl_frontend/src/core/schemaGerman.test.ts` holds every payload to German.
    .nonempty({ error: "Diese Einladung nennt keinen Link." })
    .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: "Dieser Link ist zu lang." }),
});
export type FLEinladungMailPayload = z.infer<typeof FLEinladungMailPayloadSchema>;

/**
 * Mirrors `FLEinladungVersand`. **A carrier holding no `zustellung` is an invite NOBODY MAILED**,
 * which is a different fact from a message that went out and did not arrive.
 */
export const FLEinladungVersandSchema = z.object({
  // Nullable and never optional: the mint writes the carrier EMPTY, but FastAPI serialises the
  // default, so the key rides on every invitation with `null` in it. The three sibling mirrors of
  // this same backend model spell it the same way.
  zustellung: FLBewerbungZustellungSchema.nullable(),
});
export type FLEinladungVersand = z.infer<typeof FLEinladungVersandSchema>;

/**
 * Mirrors `FLEinladung` — the live invite as an administrator is shown it. **No `token_hash`**: the
 * credential is written as a hash the store never yields, so no read model carries one and neither
 * may this (`docs/backend/spec.md :: I144`'s twin).
 */
export const FLEinladungSchema = z.object({
  // The row a delivery report is filed against (`ziel_id`), which is why a read model carries it at
  // all: the mail press is a second press, and by then the mint's own answer is gone.
  id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  erstellt_am: CustomDateStringSchema,
  // The administrator's own address, as `bewerbungen.entscheidung.von` is read from the bound actor.
  erstellt_von: z.string(),
  // Null on every row this read serves, the read finding the live one; the field is mirrored because
  // the stored row carries it and a reader of the model would otherwise think a revoke leaves none.
  widerrufen_am: CustomDateStringSchema.nullable(),
  versand: FLEinladungVersandSchema.nullable(),
});
export type FLEinladung = z.infer<typeof FLEinladungSchema>;

/** `null` where the team holds no live invite for the season, which is every team before the first mint. */
export const FLEinladungResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  einladung: FLEinladungSchema.nullable(),
  // The registration window's verdict, composed server-side as `FLBewerbungFensterResponse.laeuft`
  // is: a link expires with the window rather than on a date of its own.
  laeuft: z.boolean(),
});
export type FLEinladungResponse = z.infer<typeof FLEinladungResponseSchema>;

/**
 * What a mint answers, and the only place the raw link value exists outside the recipient's inbox:
 * the panel shows it once, for copying, and a reload cannot get it back.
 */
export const FLEinladungMintResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  einladung_id: CustomObjectIdStringSchema,
  token: z.string(),
  erstellt_am: CustomDateStringSchema,
  erstellt_von: z.string(),
});
export type FLEinladungMintResponse = z.infer<typeof FLEinladungMintResponseSchema>;

/** What the revoke answers: the row it closed. Nothing reverses it — the next link is a fresh mint. */
export const FLEinladungWriteResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  einladung_id: CustomObjectIdStringSchema,
});
export type FLEinladungWriteResponse = z.infer<typeof FLEinladungWriteResponseSchema>;

/**
 * **One payload for the preview AND the press**: a shape carrying the re-send choice to one of them
 * alone is how a page comes to list one set of teams and write to another.
 */
export const FLEinladungVersandPayloadSchema = z.object({
  // The season travels in the PATH on the wire; it is carried here because both calls have to name
  // the season they were pressed on.
  id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  // Optional because the endpoint defaults it, which on a REQUEST is what optional means: a body
  // without the key mails nobody twice, the failure a bulk control has and a per-team one does not.
  erneut: z.boolean().optional(),
});
export type FLEinladungVersandPayload = z.infer<typeof FLEinladungVersandPayloadSchema>;

/**
 * Mirrors `FLEinladungVersandGrund`. **Judged by the endpoint and never re-derived here**: a second
 * derivation is how a preview starts telling the administrator one thing while the press does another.
 */
export const FLEinladungVersandGrundSchema = z.enum(
  // The withdrawal FIRST, in the endpoint's own order: a skip naming the contact block instead
  // would send somebody to enter contacts for a team with nothing left to register for.
  [
    "austritt_eingetragen",
    "erzeugung_fehlgeschlagen",
    "erzeugung_ungewiss",
    "kein_kontaktblock",
    "keine_bestaetigte_kontaktperson",
    "bereits_gesendet",
  ],
  { error: "Diesen Grund gibt es nicht." },
);
export type FLEinladungVersandGrund = z.infer<typeof FLEinladungVersandGrundSchema>;

/**
 * Mirrors `FLEinladungEmpfaenger` — one MAILBOX the send would write to. A person holding two seats
 * is one row, named for the first seat they hold, because they get one message rather than two.
 */
export const FLEinladungEmpfaengerSchema = z.object({
  rolle: FLKontaktRolleSchema,
  vorname: z.string(),
  // Shapeless, as every stored mailbox is on a read: a value refused here would fail the whole list
  // rather than the one seat holding it (`docs/backend/spec.md :: I36`).
  email: z.string(),
});
export type FLEinladungEmpfaenger = z.infer<typeof FLEinladungEmpfaengerSchema>;

/**
 * Mirrors `FLEinladungVersandVorschauZeile` — one admitted team as the preview answers for it.
 * `empfaenger` is empty exactly where `uebersprungen` is set, so a row states either who would be
 * written to or why nobody would.
 */
export const FLEinladungVersandVorschauZeileSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  // The season's own copy of the club's name, which is what the list is read and ordered by.
  team_name: z.string(),
  empfaenger: z.array(FLEinladungEmpfaengerSchema),
  uebersprungen: FLEinladungVersandGrundSchema.nullable(),
  // **The row carries no other trace of the invitation the team holds** — no id, no link value — so
  // nothing else here can tell a team whose live link this press kills from one that never had one.
  ersetzt_link: z.boolean(),
});
export type FLEinladungVersandVorschauZeile = z.infer<typeof FLEinladungVersandVorschauZeileSchema>;

/**
 * Mirrors `FLEinladungVersandZeile` — the preview's row as the press leaves it, carrying what the
 * message needs: the link's raw value, and the row a delivery report is filed against. Both are null
 * exactly where `uebersprungen` is set.
 */
export const FLEinladungVersandZeileSchema = FLEinladungVersandVorschauZeileSchema.extend({
  einladung_id: CustomObjectIdStringSchema.nullable(),
  token: z.string().nullable(),
  // Whether the team held a live link when the press read it; null where the press failed before reading.
  hatte_link: z.boolean().nullable(),
});
export type FLEinladungVersandZeile = z.infer<typeof FLEinladungVersandZeileSchema>;

/** Every ADMITTED team of the season, skipped ones included: a list that dropped them would report a season smaller than it is. */
export const FLEinladungVersandVorschauResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  zeilen: z.array(FLEinladungVersandVorschauZeileSchema),
});
export type FLEinladungVersandVorschauResponse = z.infer<typeof FLEinladungVersandVorschauResponseSchema>;

export const FLEinladungVersandResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  zeilen: z.array(FLEinladungVersandZeileSchema),
});
export type FLEinladungVersandResponse = z.infer<typeof FLEinladungVersandResponseSchema>;
