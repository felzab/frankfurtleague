import z from "zod";

import { asSignInIdentifier, isSignInLibraryAddress } from "@/core/emailAddress";
import { BaseAPIResponseSchema } from "@/core/schemas";
import { ANKUENDIGUNGEN_MAX } from "@/features/berechtigungen/constants";
import { CustomObjectIdStringSchema, KontaktEmailSchema } from "@/shared/schemas";

/** The two tiers a grant holds; `owner` holds every power `administration` does and no request writes it. */
export const FLVerwaltungSchema = z.enum(["owner", "administration"]);
export type FLVerwaltung = z.infer<typeof FLVerwaltungSchema>;

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
});
export type FLBerechtigungZeile = z.infer<typeof FLBerechtigungZeileSchema>;

export const FLBerechtigungenListResponseSchema = BaseAPIResponseSchema.extend({
  berechtigungen: z.array(FLBerechtigungZeileSchema),
  // Rows no request can match, left out of the list; a count above zero is a paste to repair.
  uebersprungen: z.int().nonnegative(),
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
  created_id: CustomObjectIdStringSchema,
});
export type FLPostBerechtigungResponse = z.infer<typeof FLPostBerechtigungResponseSchema>;

/** The revoke call: an id in the path, no request body. */
export const FLBerechtigungKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLBerechtigungKeyPayload = z.infer<typeof FLBerechtigungKeyPayloadSchema>;

/** The revoke is hard, so the id is all there is to answer with. */
export const FLBerechtigungWriteResponseSchema = BaseAPIResponseSchema.extend({
  berechtigung_id: CustomObjectIdStringSchema,
});
export type FLBerechtigungWriteResponse = z.infer<typeof FLBerechtigungWriteResponseSchema>;

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
  art: z.enum(["erteilt", "entzogen", "geaendert"]),
  // Where the change came from, read here and never off a null actor, which a barred administrator also is.
  urheber: z.enum(["anwendung", "datenbank"]),
  jetzt: FLBerechtigungStandSchema.nullable(),
  vorher: FLBerechtigungStandSchema.nullable(),
  // Null for a change made in the database, and for one whose administrator is barred, which the flag says.
  geaendert_von: z.string().nullable(),
  geaendert_von_gesperrt: z.boolean(),
  geaendert_am: z.string().nullable(),
  gesperrt: z.boolean(),
  // Counted by the backend on the row, so a restart of this process gives nobody a second day of passes.
  aufgegeben: z.boolean(),
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
