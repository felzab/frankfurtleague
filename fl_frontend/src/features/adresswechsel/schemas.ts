import z from "zod";

import { ADRESSWECHSEL_WEGE } from "@/core/adresswechsel";
import { BaseAPIResponseSchema } from "@/core/schemas";
import { ANKUENDIGUNGEN_MAX } from "@/features/berechtigungen/constants";
import { FLVerwaltungSchema } from "@/features/berechtigungen/schemas";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { ERASURE_ANLASS_MAX_LENGTH } from "@/features/funktionen/constants";
import { ADRESSE_IM_GRUND_REGEX } from "@/features/sperrliste/schemas";
import {
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  einzeiligerName,
  FLBewerbungZustellungSchema,
  KontaktEmailSchema,
} from "@/shared/schemas";

/** Mirrors `FLAdresswechselWeg`: how a change reaches its effect, which the account page, the link page and the tool share. */
export const FLAdresswechselWegSchema = z.enum(ADRESSWECHSEL_WEGE);
export type FLAdresswechselWeg = z.infer<typeof FLAdresswechselWegSchema>;

/** Mirrors `FLAdresswechselWartetAuf`: the step a live change waits on, an administrator's approval among them. */
export const FLAdresswechselWartetAufSchema = z.enum(["freigabe", "neue_adresse", "genehmigung", "wartezeit"]);
export type FLAdresswechselWartetAuf = z.infer<typeof FLAdresswechselWartetAufSchema>;

/** Mirrors `FLAdresswechselBisherigZustand`: the same steps as the stop link of the address on file reads them. */
export const FLAdresswechselBisherigZustandSchema = z.enum(["freigabe_offen", "offen", "genehmigung", "wartezeit"]);
export type FLAdresswechselBisherigZustand = z.infer<typeof FLAdresswechselBisherigZustandSchema>;

/** Mirrors `FLAdresswechselEndeArt`: how an ended change ended, which its tombstone keeps after the address is gone. */
export const FLAdresswechselEndeArtSchema = z.enum(["wirksam", "abgelehnt", "gestoppt", "abgelaufen", "ersetzt", "verworfen"]);
export type FLAdresswechselEndeArt = z.infer<typeof FLAdresswechselEndeArtSchema>;

/**
 * Mirrors `CustomAdresswechselGrund`, the erasure occasion's bounds: copied into the start's log row and
 * kept with the log, so the backend refuses a name of the person in it (`REQ-ADRESSWECHSEL-008`).
 */
export const AdresswechselGrundSchema = einzeiligerName(
  z
    .string({ error: "Bitte gib einen Grund ein." })
    .trim()
    .nonempty({ error: "Bitte gib einen Grund ein." })
    .max(ERASURE_ANLASS_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(ERASURE_ANLASS_MAX_LENGTH)} Zeichen lang sein.` }),
  "Der Grund",
)
  // The log row outlives the change by a year, and no redaction reaches its reason.
  .refine((grund) => !ADRESSE_IM_GRUND_REGEX.test(grund), { error: "Der Grund darf keine E-Mail-Adresse enthalten." });

// ---- The link page: public, the token in a body ------------------------------------------------

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link aus Deiner E-Mail erneut.";

/** One sentence for the missing token and the over-long one: a visitor typed neither, so the repair is the link opened again. */
const adresswechselToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

/** Mirrors `FLAdresswechselAnsichtPayload`: a second URL carrying the credential would be a second line the edge has to redact. */
export const FLAdresswechselAnsichtPayloadSchema = z.object({
  token: adresswechselToken,
});
export type FLAdresswechselAnsichtPayload = z.infer<typeof FLAdresswechselAnsichtPayloadSchema>;

/**
 * Mirrors `FLAdresswechselAnsichtNeu`, what the new mailbox's link is told. Never a name or either address:
 * a leaked link learns no mailbox to write to.
 */
export const FLAdresswechselAnsichtNeuSchema = z.object({
  seite: z.literal("neu"),
  // `bestaetigt` is a pressed link whose change still stands, waiting on its time or an approval;
  // `genehmigung_abgelaufen` one whose approval's week ran out, which the hourly pass ends unapproved.
  zustand: z.enum(["gueltig", "abgelaufen", "gesperrt", "nicht_bestaetigbar", "bestaetigt", "genehmigung_abgelaufen"]),
  // Null exactly on a pressed link, which runs to no deadline of its own.
  gueltig_bis: z.string().nullable(),
  wirksam_ab: z.string().nullable(),
  weg: FLAdresswechselWegSchema,
  // Null exactly where not `bestaetigt`: before the press it would tell a mistyped link's holder the account is an administrator's.
  genehmigung_offen: z.boolean().nullable(),
});
export type FLAdresswechselAnsichtNeu = z.infer<typeof FLAdresswechselAnsichtNeuSchema>;

/** Mirrors `FLAdresswechselAnsichtBisherig`: the stop link, offered in every live state as the decline is. */
export const FLAdresswechselAnsichtBisherigSchema = z.object({
  seite: z.literal("bisherig"),
  zustand: FLAdresswechselBisherigZustandSchema,
  gueltig_bis: z.string().nullable(),
  wirksam_ab: z.string().nullable(),
  weg: FLAdresswechselWegSchema,
});
export type FLAdresswechselAnsichtBisherig = z.infer<typeof FLAdresswechselAnsichtBisherigSchema>;

/** Mirrors `FLAdresswechselAnsichtBeendet`: an ended change's tombstone, so either link answers truthfully after the end. */
export const FLAdresswechselAnsichtBeendetSchema = z.object({
  seite: z.enum(["neu", "bisherig"]),
  zustand: z.literal("beendet"),
  art: FLAdresswechselEndeArtSchema,
});
export type FLAdresswechselAnsichtBeendet = z.infer<typeof FLAdresswechselAnsichtBeendetSchema>;

export const FLAdresswechselAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  // A plain union: `seite` alone does not tell a tombstone from a live side.
  ansicht: z.union([FLAdresswechselAnsichtBeendetSchema, FLAdresswechselAnsichtNeuSchema, FLAdresswechselAnsichtBisherigSchema]),
});
export type FLAdresswechselAnsichtResponse = z.infer<typeof FLAdresswechselAnsichtResponseSchema>;

/** Mirrors `FLAdresswechselAntwortPayload`: `bestaetigt` moves the address there, `abgelehnt` discards the change. */
export const FLAdresswechselAntwortPayloadSchema = z.object({
  token: adresswechselToken,
  antwort: z.enum(["bestaetigt", "abgelehnt"], { error: LINK_UNVOLLSTAENDIG }),
});
export type FLAdresswechselAntwortPayload = z.infer<typeof FLAdresswechselAntwortPayloadSchema>;

export const FLAdresswechselAntwortResponseSchema = BaseAPIResponseSchema.extend({
  antwort: z.enum(["bestaetigt", "abgelehnt"]),
  // Set where a change with a waiting time now waits: the hourly pass writes its effect then.
  wirksam_ab: z.string().nullable(),
  // Confirmed, and the effect waits for an administrator's approval.
  genehmigung_offen: z.boolean(),
  // Set where the confirmation took effect: its notice waits in the outbox, never in this answer.
  wirksam: z.boolean(),
});
export type FLAdresswechselAntwortResponse = z.infer<typeof FLAdresswechselAntwortResponseSchema>;

/** Mirrors `FLAdresswechselStoppPayload`: the stop of the address on file, by the token its notice carried. */
export const FLAdresswechselStoppPayloadSchema = z.object({
  token: adresswechselToken,
});
export type FLAdresswechselStoppPayload = z.infer<typeof FLAdresswechselStoppPayloadSchema>;

export const FLAdresswechselStoppResponseSchema = BaseAPIResponseSchema.extend({
  gestoppt: z.literal(true),
});
export type FLAdresswechselStoppResponse = z.infer<typeof FLAdresswechselStoppResponseSchema>;

// ---- The hourly pass -----------------------------------------------------------------------------

export const FLAdresswechselSweepResponseSchema = BaseAPIResponseSchema.extend({
  entfernt: z.int().nonnegative(),
  // Counts alone: each change's notice was queued in its own transaction, for the outbox's claim.
  verworfen: z.int().nonnegative(),
  wirksam: z.int().nonnegative(),
  // Every lapsed or due change still standing after this call, an earlier page's failures among them.
  verbleibend: z.int().nonnegative(),
  nach: CustomObjectIdStringSchema.nullable(),
});
export type FLAdresswechselSweepResponse = z.infer<typeof FLAdresswechselSweepResponseSchema>;

/**
 * Mirrors `FLAdresswechselPostausgangZeile`: one notice an end owes, for this server alone. `wirksam` greets `vorname`,
 * nobody where null, at the replaced address and carries its account; `verworfen` tells the new address alone.
 */
export const FLAdresswechselPostausgangZeileSchema = z.object({
  id: CustomObjectIdStringSchema,
  art: z.enum(["wirksam", "verworfen"]),
  bisherige_email: z.string().nonempty().nullable(),
  email: z.string().nonempty(),
  vorname: z.string().nullable(),
  // Whether the address on file's holder asked for or approved the change, which decides whether its account moves.
  weg: FLAdresswechselWegSchema.nullable(),
  aufgegeben: z.boolean(),
});
export type FLAdresswechselPostausgangZeile = z.infer<typeof FLAdresswechselPostausgangZeileSchema>;

export const FLAdresswechselPostausgangResponseSchema = BaseAPIResponseSchema.extend({
  beanspruchung: z.string().nullable(),
  beansprucht_bis: z.string().nullable(),
  mitteilungen: z.array(FLAdresswechselPostausgangZeileSchema),
});
export type FLAdresswechselPostausgangResponse = z.infer<typeof FLAdresswechselPostausgangResponseSchema>;

/** Mirrors `FLAdresswechselZugestelltPayload`: the ids a claim delivered, stamped under that claim alone. */
export const FLAdresswechselZugestelltPayloadSchema = z.object({
  // Handed back as the claim answered it, never typed: no person reads a refusal of it.
  beanspruchung: z.string(),
  ids: z.array(CustomObjectIdStringSchema).min(1).max(ANKUENDIGUNGEN_MAX),
});
export type FLAdresswechselZugestelltPayload = z.infer<typeof FLAdresswechselZugestelltPayloadSchema>;

export const FLAdresswechselZugestelltResponseSchema = BaseAPIResponseSchema.extend({
  zugestellt: z.int().nonnegative(),
  ignoriert: z.int().nonnegative(),
});
export type FLAdresswechselZugestelltResponse = z.infer<typeof FLAdresswechselZugestelltResponseSchema>;

// ---- The address tool: admin tier ----------------------------------------------------------------

/** Mirrors `FLAdresswechselVerwaltungAnsichtPayload`: exactly one key, the address typed or a change's id from a link. */
export const FLAdresswechselVerwaltungAnsichtPayloadSchema = z
  .object({
    // Nullable as well as optional, mirroring `CustomEmail | None` and `CustomObjectId | None`: the backend
    // reads a null key as an absent one, so the one-key check below does too.
    adresse: KontaktEmailSchema.nullable().optional(),
    adresswechsel_id: CustomObjectIdStringSchema.nullable().optional(),
  })
  .refine(({ adresse, adresswechsel_id }) => (adresse == null) !== (adresswechsel_id == null), {
    error: "Gib eine E-Mail-Adresse ein.",
  });
export type FLAdresswechselVerwaltungAnsichtPayload = z.infer<typeof FLAdresswechselVerwaltungAnsichtPayloadSchema>;

/** Mirrors `FLAdresswechselVerwaltungBestand`: what the address holds that a change moves, counted. */
export const FLAdresswechselVerwaltungBestandSchema = z.object({
  spieler: z.int().nonnegative(),
  schiedsrichter: z.int().nonnegative(),
  sitze: z.int().nonnegative(),
  bewerbungssitze: z.int().nonnegative(),
  registrierungen: z.int().nonnegative(),
  berechtigung: FLVerwaltungSchema.nullable(),
});
export type FLAdresswechselVerwaltungBestand = z.infer<typeof FLAdresswechselVerwaltungBestandSchema>;

/** Mirrors `FLAdresswechselVerwaltungGenehmigung`: the approval a grant holder's change waits for, read-only here. */
export const FLAdresswechselVerwaltungGenehmigungSchema = z.object({
  verwaltung: FLVerwaltungSchema,
  bis: z.string(),
  genehmigt_am: z.string().nullable(),
});
export type FLAdresswechselVerwaltungGenehmigung = z.infer<typeof FLAdresswechselVerwaltungGenehmigungSchema>;

/**
 * Mirrors `FLAdresswechselVerwaltungOffen`: the live change at the address, its new address whole on the
 * administrator's tier. An instant is null where its `weg` has not reached that step.
 */
export const FLAdresswechselVerwaltungOffenSchema = z.object({
  id: CustomObjectIdStringSchema,
  email: z.string(),
  weg: FLAdresswechselWegSchema,
  grund: z.string().nullable(),
  wartet_auf: FLAdresswechselWartetAufSchema,
  verschickt_am: CustomDateStringSchema,
  gueltig_bis: z.string().nullable(),
  freigegeben_am: z.string().nullable(),
  bestaetigt_am: z.string().nullable(),
  wirksam_ab: z.string().nullable(),
  zustellung: FLBewerbungZustellungSchema.nullable(),
  // The read's judgement of the deadline: a lapsed change stands until the pass ends it, so the instant alone reads as running.
  abgelaufen: z.boolean(),
  genehmigung: FLAdresswechselVerwaltungGenehmigungSchema.nullable(),
});
export type FLAdresswechselVerwaltungOffen = z.infer<typeof FLAdresswechselVerwaltungOffenSchema>;

export const FLAdresswechselVerwaltungAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  // The address the read was made for, folded: what the start names and the page shows above its counts.
  adresse: z.string(),
  bestand: FLAdresswechselVerwaltungBestandSchema,
  // Whether the address holds anything a change moves, which is what offers the start.
  moeglich: z.boolean(),
  offen: FLAdresswechselVerwaltungOffenSchema.nullable(),
});
export type FLAdresswechselVerwaltungAnsichtResponse = z.infer<typeof FLAdresswechselVerwaltungAnsichtResponseSchema>;

/**
 * Mirrors `FLAdresswechselVerwaltungPayload`: an administrator's start for a person who says they cannot sign in.
 * `grund` null asks the address on file to approve first; a reason starts the waiting time.
 */
export const FLAdresswechselVerwaltungPayloadSchema = z.object({
  adresse: KontaktEmailSchema,
  email: KontaktEmailSchema,
  grund: AdresswechselGrundSchema.nullable(),
});
export type FLAdresswechselVerwaltungPayload = z.infer<typeof FLAdresswechselVerwaltungPayloadSchema>;

/**
 * Mirrors `FLAdresswechselVerwaltungMintResponse`, answered ONCE: the raw tokens exist here and in the two
 * mailboxes alone, so no read model and no log line may carry this shape.
 */
export const FLAdresswechselVerwaltungMintResponseSchema = BaseAPIResponseSchema.extend({
  // The change's own id, which its delivery is tagged by and its re-send and discard name.
  id: CustomObjectIdStringSchema,
  weg: FLAdresswechselWegSchema,
  // Null while a `freigabe` change waits on its approval: nothing goes to the new mailbox before it.
  token: z.string().nullable(),
  // Null on a re-send: the stop link already in the mailbox of the address on file keeps working.
  stopp_token: z.string().nullable(),
  gueltig_bis: z.string(),
  // The address the mint's own transaction read. Mailing the one a caller typed or read BEFORE the
  // mint sends the credential to a mailbox a rival request has already replaced.
  email: z.string().nonempty(),
  // The address still in force, which is told a change was asked and never which one.
  bisherige_email: z.string().nonempty(),
  // What the notice greets with, read in the mint's own transaction; null on the lost-mailbox way, greeting nobody.
  vorname: z.string().nullable(),
  // How many could approve the grant's move, whom the grants' outbox tells (`docs/backend/spec.md :: I862`); 0 where none moves.
  genehmiger_anzahl: z.int().nonnegative(),
});
export type FLAdresswechselVerwaltungMintResponse = z.infer<typeof FLAdresswechselVerwaltungMintResponseSchema>;

/** The re-send, the discard and the approval: the id in the path, no request body. One schema per control. */
export const FLAdresswechselEinladenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLAdresswechselEinladenPayload = z.infer<typeof FLAdresswechselEinladenPayloadSchema>;

export const FLAdresswechselVerwerfenPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLAdresswechselVerwerfenPayload = z.infer<typeof FLAdresswechselVerwerfenPayloadSchema>;

export const FLAdresswechselGenehmigungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLAdresswechselGenehmigungPayload = z.infer<typeof FLAdresswechselGenehmigungPayloadSchema>;

/** Mirrors `FLAdresswechselIdResponse`, the discard's answer: the change it ended, and nothing of what it held. */
export const FLAdresswechselIdResponseSchema = BaseAPIResponseSchema.extend({
  id: CustomObjectIdStringSchema,
});
export type FLAdresswechselIdResponse = z.infer<typeof FLAdresswechselIdResponseSchema>;

/**
 * Mirrors `FLAdresswechselGenehmigungResponse`. Where the approval was the last step, the change took effect
 * in that same press and its notice waits in the outbox, as the confirmation's would.
 */
export const FLAdresswechselGenehmigungResponseSchema = BaseAPIResponseSchema.extend({
  id: CustomObjectIdStringSchema,
  wirksam: z.boolean(),
});
export type FLAdresswechselGenehmigungResponse = z.infer<typeof FLAdresswechselGenehmigungResponseSchema>;
