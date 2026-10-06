import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
// The wire's three seats, mirrored once: a second enum here would let the reveal name a seat no
// other response of this API publishes.
import { FLBewerbungPersonEinwilligungPayloadSchema, FLKontaktRolleSchema, FLKontaktZeileSchema } from "@/features/bewerbungen/schemas";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { FLEinwilligungStandSchema } from "@/features/spieler/schemas";
import { FLKontaktKenntnisnahmeSchema, FLSaisonTeamKontaktePayloadSchema, FLSaisonTeamKontakteSchema } from "@/features/teams/schemas";
import { addressSchema, CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * The address IS the identity: nothing joins one season's Trainer to the next, so the request names
 * a person and not a row. Its own declaration, so no value typed for a write reaches the deletion.
 */
export const FLKontaktErasurePayloadSchema = z.object({
  // No address rule, as the API's lookup holds none: a stored address that a rule came to refuse
  // later must stay erasable (GDPR Art. 17).
  email: addressSchema((address) => address.includes("@")),
});
export type FLKontaktErasurePayload = z.infer<typeof FLKontaktErasurePayloadSchema>;

/**
 * Mirrors `FLKontaktSitz` — one seat, by name and by the season it sits in, and no contact record:
 * the confirmation answers WHOM, never what the request exists to destroy.
 */
export const FLKontaktSitzSchema = z.object({
  saison_id: z.string(),
  // Beside the name because a person seated twice in one season is otherwise two rows a reader
  // cannot tell apart, which is what `trainer_ist_zugleich` produces.
  rolle: FLKontaktRolleSchema,
  vorname: z.string(),
  nachname: z.string(),
});
export type FLKontaktSitz = z.infer<typeof FLKontaktSitzSchema>;

/**
 * Mirrors `FLKontaktErasureAnsichtResponse` — whom `POST /kontakte/erasure` would reach, before it
 * runs. The two lists stay apart: an application is a request to join, and a junction row is a
 * season already played.
 */
export const FLKontaktErasureAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  saison_teams: z.array(FLKontaktSitzSchema),
  bewerbungen: z.array(FLKontaktSitzSchema),
});
export type FLKontaktErasureAnsichtResponse = z.infer<typeof FLKontaktErasureAnsichtResponseSchema>;

/**
 * Mirrors `FLKontaktErasureResponse` — counts alone, and deliberately no echo of the person. The
 * request named an address, so answering with anything of theirs would hand back a fresh copy of
 * exactly what the request destroyed.
 */
export const FLKontaktErasureResponseSchema = BaseAPIResponseSchema.extend({
  cleared_saison_teams: z.int().nonnegative(),
  cleared_bewerbungen: z.int().nonnegative(),
  /**
   * The slots actually nulled, across both collections. Higher than the two row counts wherever
   * `trainer_ist_zugleich` seated one person twice in one row, which is what makes this the
   * figure the report counts contact entries by.
   */
  cleared_kontakt_slots: z.int().nonnegative(),
  /** Log rows whose image was emptied and stamped. Never a deletion count: no row is dropped. */
  redacted_aktionen: z.int().nonnegative(),
});
export type FLKontaktErasureResponse = z.infer<typeof FLKontaktErasureResponseSchema>;

/**
 * Mirrors `FLPatchSaisonTeamKontaktePayload` — the three seats and the token naming which block they
 * were composed against. `FLSaisonTeamKontaktePayloadSchema` is reused: the junction PATCH takes the
 * same block, and a second spelling would drift with nothing able to see it.
 */
export const FLPatchSaisonTeamKontaktePayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key. They
  // are carried here because the form has to know which club's season it is writing.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: `Die Saison-ID besteht aus genau ${String(SAISON_ID_LENGTH)} Zeichen.` }),
  // The whole block, or `null` to clear it. REQUIRED with no default: a form that omits it gets a
  // 422, never three people quietly left standing.
  kontakte: FLSaisonTeamKontaktePayloadSchema.nullable(),
  // Echoed back exactly as the read served it (`REQ-KONTAKT-001`). Unbounded on purpose: a token no
  // read minted is refused there anyway, and a bound here would mark a box nothing renders.
  kontakte_stand: z.string(),
});
export type FLPatchSaisonTeamKontaktePayload = z.infer<typeof FLPatchSaisonTeamKontaktePayloadSchema>;

/**
 * Mirrors `FLKontaktMint` — one link minted for one person, with everything its message names. The raw
 * token is answered here and nowhere else: unmailed, it exists in no inbox and the seat never confirms.
 */
export const FLKontaktMintSchema = z.object({
  token: z.string(),
  // Two where the Trainer also holds the seat named: one person, one link.
  rollen: z.array(FLKontaktRolleSchema),
  // The address the mint's own transaction stored, never the one a caller sent.
  email: z.string(),
  vorname: z.string(),
  schule: z.string(),
  frist: CustomDateStringSchema,
  // The row's state, read in the mint's own transaction: it fixes what the link's page takes, so the
  // mail asks for exactly that.
  zeile: FLKontaktZeileSchema,
});
export type FLKontaktMint = z.infer<typeof FLKontaktMintSchema>;

/**
 * Mirrors `FLPatchSaisonTeamKontakteResponse` — the block as stored after the write, and no other
 * field of the row. The endpoint answers about the seats it moved, so the group and the Austritt
 * beside them are not its to echo.
 */
export const FLPatchSaisonTeamKontakteResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  // The delivery record's `ziel_id`: the row is the record a contact seat's message is about.
  saison_team_id: CustomObjectIdStringSchema,
  kontakte: FLSaisonTeamKontakteSchema.nullable(),
  // The token of the block this save left, which is the only precondition an undo of it can carry.
  kontakte_stand: z.string(),
  bestaetigungen: z.array(FLKontaktMintSchema),
});
export type FLPatchSaisonTeamKontakteResponse = z.infer<typeof FLPatchSaisonTeamKontakteResponseSchema>;

/** Which seat of which season row the re-send names. All three travel in the path, so the request carries no body. */
export const FLKontaktEinladenPayloadSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  saison_id: FLPatchSaisonTeamKontaktePayloadSchema.shape.saison_id,
  rolle: FLKontaktRolleSchema,
});
export type FLKontaktEinladenPayload = z.infer<typeof FLKontaktEinladenPayloadSchema>;

/** Mirrors `FLKontaktEinladenResponse` — the link the re-send minted, replacing the seat's earlier one whole. */
export const FLKontaktEinladenResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  saison_team_id: CustomObjectIdStringSchema,
  bestaetigung: FLKontaktMintSchema,
});
export type FLKontaktEinladenResponse = z.infer<typeof FLKontaktEinladenResponseSchema>;

/** The application seat's payload, as the backend publishes one declaration under both names: the two writes cannot drift. */
export const FLSaisonTeamPersonEinwilligungPayloadSchema = FLBewerbungPersonEinwilligungPayloadSchema;
export type FLSaisonTeamPersonEinwilligungPayload = z.infer<typeof FLSaisonTeamPersonEinwilligungPayloadSchema>;

/** Mirrors `FLSaisonTeamPersonEinwilligungResponse`: every seat of the person's on that row, moved together. */
export const FLSaisonTeamPersonEinwilligungResponseSchema = BaseAPIResponseSchema.extend({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  rollen: z.array(FLKontaktRolleSchema),
  umfang: FLKontaktKenntnisnahmeSchema.shape.umfang,
  medien: z.boolean(),
  nachweis_stand: FLEinwilligungStandSchema,
});
export type FLSaisonTeamPersonEinwilligungResponse = z.infer<typeof FLSaisonTeamPersonEinwilligungResponseSchema>;
