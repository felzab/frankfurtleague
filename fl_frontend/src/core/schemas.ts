import z from "zod";

import { CustomObjectIdStringSchema } from "./objectId";

/**
 * The envelope every FastAPI response carries, mirroring the backend's `BaseAPIResponse`.
 *
 * Not in `api.ts`: that module is `server-only`, and every feature `schemas.ts` value-imports this
 * envelope, which would taint them all.
 */
export const BaseAPIResponseSchema = z.object({ acknowledged: z.literal([0, 1]) });
export type BaseAPIResponse = z.infer<typeof BaseAPIResponseSchema>;

/** Every failure's body, mirroring the backend's `FLFailureBody` (`docs/logging/spec.md :: L4`). */
export const FLFailureBodySchema = z.object({ error_code: z.string(), trace_id: z.string() });

/** One refusal a `REQ-VAL-001` names; `kind` is pydantic's error `type`. */
export const FLRefusedFieldSchema = z.object({
  in: z.enum(["body", "query", "path", "header", "cookie"]),
  path: z.array(z.union([z.string(), z.number().int()])),
  kind: z.string(),
});
export type FLRefusedField = z.infer<typeof FLRefusedFieldSchema>;

export const FLRefusedPayloadBodySchema = FLFailureBodySchema.extend({ fields: z.array(FLRefusedFieldSchema) });

/**
 * Which mailbox `POST /identitaet/subjekt` is asked about, folded
 * (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). No length or alphabet is restated
 * here: `core` may not import `fl_frontend/src/shared/schemas.ts`
 * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`), and a second copy would drift unwatched.
 */
export const FLSubjektPayloadSchema = z.object({ email: z.string() });
export type FLSubjektPayload = z.infer<typeof FLSubjektPayloadSchema>;

/**
 * One contact seat the mailbox holds on a `saison_teams` row, per seat rather than per person: one
 * junction row seats one person twice where `trainer_ist_zugleich` says so.
 */
export const FLSubjektSitzSchema = z.object({
  saison_id: z.string(),
  team_id: CustomObjectIdStringSchema,
  // The contact-seat sense of the word, never the captaincy's
  // (`fl_backend/app/api/bewerbungen/schemas.py :: FLKontaktRolle`).
  rolle: z.enum(["trainer", "ansprechperson", "stellvertretung"]),
  // The name the club was PLAYED under, never the one it carries now
  // (`docs/backend/spec.md :: I13`).
  team_name: z.string(),
  saison_status: z.enum(["past", "active", "future"]),
});
export type FLSubjektSitz = z.infer<typeof FLSubjektSitzSchema>;

/** One pupil record the mailbox names, the id alone: the caller composed the address it asked about. */
export const FLSubjektSpielerSchema = z.object({ spieler_id: CustomObjectIdStringSchema });
export type FLSubjektSpieler = z.infer<typeof FLSubjektSpielerSchema>;

/** One referee record the mailbox names, carrying the id alone for `FLSubjektSpielerSchema`'s reason. */
export const FLSubjektSchiedsrichterSchema = z.object({ schiedsrichter_id: CustomObjectIdStringSchema });
export type FLSubjektSchiedsrichter = z.infer<typeof FLSubjektSchiedsrichterSchema>;

/**
 * Which confirmed, live league records one mailbox matches. A list under each rather than an
 * optional record: one person holds seats at two clubs, and nothing enforces one pupil record per
 * address (`docs/datenschutz.md :: "One address is one person"`).
 */
export const FLSubjektResponseSchema = BaseAPIResponseSchema.extend({
  sitze: z.array(FLSubjektSitzSchema),
  spieler: z.array(FLSubjektSpielerSchema),
  schiedsrichter: z.array(FLSubjektSchiedsrichterSchema),
  // Read beside the lists and never from their being empty: empty lists with this set are records
  // that could grant a panel and that nobody has confirmed, not a mailbox the league holds nothing for
  // (`docs/backend/spec.md :: I374`).
  unbestaetigt: z.boolean(),
  // Whether the address is on the ban list; it narrows none of the lists above
  // (`docs/backend/spec.md :: I389`).
  gesperrt: z.boolean(),
  // The tier of the grant the address holds, null for none: the administrator verdict's one source,
  // read per request and never stamped on a session (`docs/backend/spec.md :: I383`).
  verwaltung: z.enum(["owner", "administration"]).nullable(),
  // When that grant took effect, null exactly where `verwaltung` is: a session made before it is no
  // administrator's (`docs/backend/spec.md :: I525`). An instant carrying its offset, as every served one does.
  berechtigt_seit: z.string().nullable(),
  // When the `owner` tier took effect, null exactly where `verwaltung` is not `owner`: a session made
  // before it administers and holds no owner's power (`docs/backend/spec.md :: I534`).
  inhaber_seit: z.string().nullable(),
});
export type FLSubjektResponse = z.infer<typeof FLSubjektResponseSchema>;

/**
 * What `POST /identitaet/anmeldung` answers the sign-in gate, asked with `FLSubjektPayloadSchema`:
 * flags and the grant's tier, and no record.
 */
export const FLAnmeldungResponseSchema = BaseAPIResponseSchema.extend({
  // The subject read's own flag, from the same judgement (`docs/backend/spec.md :: I374`).
  unbestaetigt: z.boolean(),
  // Set wherever the account page serves the address anything, a record granting no panel included:
  // a retired row, a past or withdrawn season's seat, a pending application's or registration's.
  konto: z.boolean(),
  // Narrowing neither flag above (`docs/backend/spec.md :: I389`).
  gesperrt: z.boolean(),
  verwaltung: z.enum(["owner", "administration"]).nullable(),
});
export type FLAnmeldungResponse = z.infer<typeof FLAnmeldungResponseSchema>;

/**
 * The address `POST /identitaet/gesperrt` is asked about, as the mailer was handed it. No length or
 * alphabet restated, for `FLSubjektPayloadSchema`'s reason.
 */
export const FLGesperrtPayloadSchema = z.object({ email: z.string() });
export type FLGesperrtPayload = z.infer<typeof FLGesperrtPayloadSchema>;

/** Whether a standing ban holds that address, and nothing of any record (`docs/backend/spec.md :: I543`). */
export const FLGesperrtResponseSchema = BaseAPIResponseSchema.extend({ gesperrt: z.boolean() });

/**
 * The words one registry label names. `seite` stays an open string: a page the backend adds needs no
 * change here, and each reader names the page it renders itself.
 */
export const FLEinwilligungFassungSchema = z.object({
  text_version: z.string(),
  seite: z.string(),
  gilt_ab: z.string(),
  absaetze: z.array(z.string()),
  schalter: z.string(),
  bedienelemente: z.record(z.string(), z.string()),
  // Null on every label whose keys were never kept, which no page places by key.
  absaetze_nach_schluessel: z.record(z.string(), z.string()).nullable(),
  platzhalter: z.array(z.string()),
});
export type FLEinwilligungFassung = z.infer<typeof FLEinwilligungFassungSchema>;

export const FLEinwilligungFassungResponseSchema = BaseAPIResponseSchema.extend({ fassung: FLEinwilligungFassungSchema });

export const FLEinwilligungSeitenResponseSchema = BaseAPIResponseSchema.extend({ laufende_fassungen: z.record(z.string(), z.string()) });

/**
 * What an erasure removed of one person, as record counts by store and never an echo of the person: anything
 * of theirs answered back is a fresh copy of what was destroyed. `POST /identitaet/selbst/erasure` answers it.
 */
export const FLErasureResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.int(),
  saison_spieler: z.int(),
  schiedsrichter: z.int(),
  // Fixtures moved to the erased referee's sentinel rather than deleted.
  spiele: z.int(),
  kontakt_sitze: z.int(),
  registrierungen: z.int(),
  adresswechsel: z.int(),
  berechtigungen: z.int(),
  berechtigungen_antraege: z.int(),
  drosselung: z.int(),
});
export type FLErasureResponse = z.infer<typeof FLErasureResponseSchema>;

/** A pupil record the erasure would reach, by the name it carries. */
export const FLSelbstErasureSpielerSchema = z.object({ vorname: z.string(), nachname: z.string().nullable() });

/** A referee record the erasure would reach, by the name it carries where it carries one. */
export const FLSelbstErasureSchiedsrichterSchema = z.object({ name: z.string().nullable() });

/** One contact seat on a season's team row, per seat, as `FLSubjektSitzSchema` lists them. */
export const FLSelbstErasureSitzSchema = z.object({
  saison_id: z.string(),
  team_name: z.string(),
  rolle: FLSubjektSitzSchema.shape.rolle,
  vorname: z.string(),
  nachname: z.string(),
});

/** One contact seat on an application, whatever its status. */
export const FLSelbstErasureBewerbungSchema = z.object({
  saison_id: z.string(),
  rolle: FLSubjektSitzSchema.shape.rolle,
  vorname: z.string(),
  nachname: z.string(),
});

/** One registration, whatever its status. */
export const FLSelbstErasureRegistrierungSchema = z.object({
  saison_id: z.string(),
  // Null where no season row names the team.
  team_name: z.string().nullable(),
  vorname: z.string(),
  nachname: z.string(),
});

/**
 * What `GET /identitaet/selbst/erasure/ansicht` answers: every record the erasure would reach before it
 * runs, by kind and by name, and never the address or a birthdate.
 */
export const FLSelbstErasureAnsichtResponseSchema = BaseAPIResponseSchema.extend({
  spieler: z.array(FLSelbstErasureSpielerSchema),
  schiedsrichter: z.array(FLSelbstErasureSchiedsrichterSchema),
  sitze: z.array(FLSelbstErasureSitzSchema),
  bewerbungen: z.array(FLSelbstErasureBewerbungSchema),
  registrierungen: z.array(FLSelbstErasureRegistrierungSchema),
  // Another referee's or pupil's pending change to this mailbox, which names no person to show.
  adresswechsel: z.int(),
  verwaltung: FLSubjektResponseSchema.shape.verwaltung,
  // Whether the erasure would be refused as the league's last live owner's, as the store stood at the read:
  // a flag about the press, and no record the erasure reaches.
  letzter_inhaber: z.boolean(),
});
export type FLSelbstErasureAnsichtResponse = z.infer<typeof FLSelbstErasureAnsichtResponseSchema>;
