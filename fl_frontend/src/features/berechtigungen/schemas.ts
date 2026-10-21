import z from "zod";

import { ADRESSWECHSEL_WEGE } from "@/core/adresswechsel";
import { asSignInIdentifier, isSignInLibraryAddress } from "@/core/emailAddress";
import { BaseAPIResponseSchema } from "@/core/schemas";
import { ANKUENDIGUNGEN_MAX } from "@/features/berechtigungen/constants";
import { CustomObjectIdStringSchema, KontaktEmailSchema } from "@/shared/schemas";

/** The two tiers a grant holds; `owner` holds every power `administration` does, and only an owner's tier change writes it. */
export const FLVerwaltungSchema = z.enum(["owner", "administration"], { error: "Diese Stufe gibt es nicht." });
export type FLVerwaltung = z.infer<typeof FLVerwaltungSchema>;

/**
 * Why THIS administrator may not approve an act waiting on a second pair of eyes: one judgement the backend
 * makes of an address change and a grant's request alike (`fl_backend/app/api/berechtigungen/services.py :: genehmigung_verwehrt`).
 */
const FLGenehmigungVerwehrtSchema = z.enum(["eigene", "gestartet", "inhaber", "juenger"]);
export type FLGenehmigungVerwehrt = z.infer<typeof FLGenehmigungVerwehrtSchema>;

/**
 * Mirrors `FLBerechtigungAdresswechsel`: the change the grant's address waits at, set only while another
 * administrator's approval is owed. `verwehrt` is null where this administrator may give it.
 */
export const FLBerechtigungAdresswechselSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Null where withheld: barred (`email_gesperrt`), or an owner's change a non-owner reads (`verwehrt` "inhaber").
  email: z.string().nullable(),
  email_gesperrt: z.boolean(),
  weg: z.enum(ADRESSWECHSEL_WEGE),
  // The administrator who started it, null on the person's own start (`konto`), withheld as `email` is, or barred.
  gestartet_von: z.string().nullable(),
  gestartet_von_gesperrt: z.boolean(),
  // The reason recorded for a lost mailbox, null on every other way and where withheld as `email` is.
  grund: z.string().nullable(),
  // Whether the new mailbox has confirmed, so an approval now takes effect at once.
  bestaetigt: z.boolean(),
  bis: z.string(),
  verwehrt: FLGenehmigungVerwehrtSchema.nullable(),
});
export type FLBerechtigungAdresswechsel = z.infer<typeof FLBerechtigungAdresswechselSchema>;

/** One grant, as the list serves it. */
export const FLBerechtigungZeileSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Null exactly where `gesperrt` holds: a barred address leaves the ban list on no route, this one included.
  adresse: z.string().nullable(),
  gesperrt: z.boolean(),
  verwaltung: FLVerwaltungSchema,
  // An administrator's address, or whatever a database paste wrote, an empty string included; null exactly
  // where `erteilt_von_gesperrt` holds, a barred actor being withheld as a barred grant is.
  erteilt_von: z.string().nullable(),
  erteilt_von_gesperrt: z.boolean(),
  // An instant, where most dates in this app are a calendar day.
  erteilt_am: z.string(),
  // Null on a barred row, whose change the ban refuses anyway.
  adresswechsel: FLBerechtigungAdresswechselSchema.nullable(),
});
export type FLBerechtigungZeile = z.infer<typeof FLBerechtigungZeileSchema>;

/** One grant or promotion waiting on a second administrator's approval, as the list serves it while it may still be decided. */
export const FLBerechtigungAntragZeileSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Null exactly where `gesperrt` holds, as on a grant's row.
  adresse: z.string().nullable(),
  gesperrt: z.boolean(),
  // The grant a promotion raises, null for a request for a new grant.
  berechtigung_id: CustomObjectIdStringSchema.nullable(),
  // The tier asked for: `owner` is a promotion, decided by another owner alone.
  verwaltung: FLVerwaltungSchema,
  // Null exactly where `gestartet_von_gesperrt` holds.
  gestartet_von: z.string().nullable(),
  gestartet_von_gesperrt: z.boolean(),
  angefragt_am: z.string(),
  bis: z.string(),
  // False once the person who asked has lost, since asking, the tier asked for: then nobody approves it.
  steht: z.boolean(),
  // Its requester reads `gestartet`, and withdraws it all the same.
  verwehrt: FLGenehmigungVerwehrtSchema.nullable(),
});
export type FLBerechtigungAntragZeile = z.infer<typeof FLBerechtigungAntragZeileSchema>;

export const FLBerechtigungenListResponseSchema = BaseAPIResponseSchema.extend({
  berechtigungen: z.array(FLBerechtigungZeileSchema),
  // Rows no request can match, left out of the list; a count above zero is a paste to repair.
  uebersprungen: z.int().nonnegative(),
  // Every request not yet lapsed, oldest first.
  antraege: z.array(FLBerechtigungAntragZeileSchema),
});
export type FLBerechtigungenListResponse = z.infer<typeof FLBerechtigungenListResponseSchema>;

/**
 * The grant, the address alone: no tier travels, the application granting `administration` only. Held
 * to the sign-in library's own rule besides the address box's, since a grant it refuses admits nobody
 * (`docs/frontend/spec.md :: I316`).
 */
export const FLPostBerechtigungPayloadSchema = z.object({
  email: KontaktEmailSchema.refine((email) => isSignInLibraryAddress(asSignInIdentifier(email)), {
    error: "Bitte gib eine gültige E-Mail-Adresse ein.",
  }),
});
export type FLPostBerechtigungPayload = z.infer<typeof FLPostBerechtigungPayloadSchema>;

export const FLPostBerechtigungResponseSchema = BaseAPIResponseSchema.extend({
  // The grant's id, or the request's where `beantragt` holds.
  created_id: CustomObjectIdStringSchema,
  // Another administrator could approve it, so no grant was made: a request waits instead.
  beantragt: z.boolean(),
});
export type FLPostBerechtigungResponse = z.infer<typeof FLPostBerechtigungResponseSchema>;

/** The revoke call: an id in the path, no request body. */
export const FLBerechtigungKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLBerechtigungKeyPayload = z.infer<typeof FLBerechtigungKeyPayloadSchema>;

/**
 * The tier change, the tier alone travelling. Naming the tier the grant already holds changes nothing and
 * answers as done, so a repeated press is no refusal.
 */
export const FLPatchBerechtigungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  verwaltung: FLVerwaltungSchema,
});
export type FLPatchBerechtigungPayload = z.infer<typeof FLPatchBerechtigungPayloadSchema>;

/** The revoke is hard, so the id is all there is to answer with. */
export const FLBerechtigungWriteResponseSchema = BaseAPIResponseSchema.extend({
  berechtigung_id: CustomObjectIdStringSchema,
});
export type FLBerechtigungWriteResponse = z.infer<typeof FLBerechtigungWriteResponseSchema>;

export const FLBerechtigungStufeResponseSchema = BaseAPIResponseSchema.extend({
  berechtigung_id: CustomObjectIdStringSchema,
  // A promotion another owner could approve: the tier did not move, a request waits instead.
  beantragt: z.boolean(),
});
export type FLBerechtigungStufeResponse = z.infer<typeof FLBerechtigungStufeResponseSchema>;

/** A request's approval and its refusal or withdrawal, each naming its request by the id in the path, with no body. */
export const FLBerechtigungAntragKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLBerechtigungAntragKeyPayload = z.infer<typeof FLBerechtigungAntragKeyPayloadSchema>;

/** The grant the approval wrote or promoted. */
export const FLBerechtigungAntragGenehmigtResponseSchema = BaseAPIResponseSchema.extend({
  berechtigung_id: CustomObjectIdStringSchema,
});
export type FLBerechtigungAntragGenehmigtResponse = z.infer<typeof FLBerechtigungAntragGenehmigtResponseSchema>;

/** The request removed: hard, so the id is all there is to answer with. */
export const FLBerechtigungAntragAbgelehntResponseSchema = BaseAPIResponseSchema.extend({
  antrag_id: CustomObjectIdStringSchema,
});
export type FLBerechtigungAntragAbgelehntResponse = z.infer<typeof FLBerechtigungAntragAbgelehntResponseSchema>;

/** One side of a change: the address, withheld as null where it is barred, and the tier. */
export const FLBerechtigungStandSchema = z.object({
  adresse: z.string().nullable(),
  verwaltung: FLVerwaltungSchema,
});
export type FLBerechtigungStand = z.infer<typeof FLBerechtigungStandSchema>;

/** One outbox row the pass has claimed: a change to announce, and who made it or that nobody in the application did. */
export const FLBerechtigungAenderungSchema = z.object({
  // The outbox row's own id, which is what the stamp names; never the grant's.
  id: CustomObjectIdStringSchema,
  berechtigung_id: CustomObjectIdStringSchema,
  // `beantragt` is a grant or a promotion asked for, which no grant has yet, and `adresswechsel` an address change whose
  // grant move waits on an approval: each is told to `an` alone.
  art: z.enum(["erteilt", "entzogen", "geaendert", "beantragt", "adresswechsel"]),
  // Where the change came from, read here and never off a null actor, which a barred administrator also is.
  urheber: z.enum(["anwendung", "datenbank"]),
  jetzt: FLBerechtigungStandSchema.nullable(),
  vorher: FLBerechtigungStandSchema.nullable(),
  // Null for a change made in the database, and for one whose administrator is barred, which the flag says;
  // `ERASED_ACTOR_MARKER` (`@/core/erasedActor`) for one erased since.
  geaendert_von: z.string().nullable(),
  geaendert_von_gesperrt: z.boolean(),
  geaendert_am: z.string().nullable(),
  // Why the grant's own address is null, each the subject's alone: the actor's state is read off `geaendert_von`.
  gesperrt: z.boolean(),
  geloescht: z.boolean(),
  // Counted by the backend on the row (`docs/backend/spec.md :: I480`), so a restart of this process never
  // hands a notice a second budget of passes.
  aufgegeben: z.boolean(),
  // A request's own recipients, in `empfaenger`'s place: whoever could approve it now, none once nobody can.
  // Null on every change to a grant.
  an: z.array(z.string()).nullable(),
});
export type FLBerechtigungAenderung = z.infer<typeof FLBerechtigungAenderungSchema>;

export const FLBerechtigungAbgleichResponseSchema = BaseAPIResponseSchema.extend({
  // Null together, exactly where nothing was claimed.
  beanspruchung: z.string().nullable(),
  beansprucht_bis: z.string().nullable(),
  aenderungen: z.array(FLBerechtigungAenderungSchema),
  // Every live, unbarred holder now; a removed address is read off its own change.
  empfaenger: z.array(z.string()),
  uebersprungen: z.int().nonnegative(),
});
export type FLBerechtigungAbgleichResponse = z.infer<typeof FLBerechtigungAbgleichResponseSchema>;

export const FLBerechtigungAngekuendigtPayloadSchema = z.object({
  // Handed back as the claim answered it, never typed: no person reads a refusal of it.
  beanspruchung: z.string(),
  ids: z.array(CustomObjectIdStringSchema).min(1).max(ANKUENDIGUNGEN_MAX),
});
export type FLBerechtigungAngekuendigtPayload = z.infer<typeof FLBerechtigungAngekuendigtPayloadSchema>;

export const FLBerechtigungAngekuendigtResponseSchema = BaseAPIResponseSchema.extend({
  angekuendigt: z.int().nonnegative(),
  // Named ids this claim does not hold: stamped already, unknown, or taken over by a later claim.
  ignoriert: z.int().nonnegative(),
});
export type FLBerechtigungAngekuendigtResponse = z.infer<typeof FLBerechtigungAngekuendigtResponseSchema>;
