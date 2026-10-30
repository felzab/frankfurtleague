// Redesign: goes with its last importer.
import z from "zod";

import { FLAdresswechselAntwort } from "@/core/generated/client/types";
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { LOESCHUNG_ANLASS_MAX_LENGTH } from "@/features/funktionen/constants";
import { ADRESSE_IM_GRUND_REGEX } from "@/features/sperrliste/schemas";
import { CustomObjectIdStringSchema, KontaktEmailSchema, singleLineName } from "@/shared/schemas";

/** The reason box, to the erasure occasion's bounds: copied into the start's log row and kept with the log. */
export const AdresswechselGrundSchema = singleLineName(
  z
    .string({ error: "Bitte gib einen Grund ein." })
    .trim()
    .nonempty({ error: "Bitte gib einen Grund ein." })
    .max(LOESCHUNG_ANLASS_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(LOESCHUNG_ANLASS_MAX_LENGTH)} Zeichen lang sein.` }),
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

/** The new mailbox's press: `bestaetigt` moves the address there, `abgelehnt` discards the change. */
export const FLAdresswechselAntwortPayloadSchema = z.object({
  token: adresswechselToken,
  antwort: z.enum(FLAdresswechselAntwort, { error: LINK_UNVOLLSTAENDIG }),
});

/** The stop of the address on file, by the token its notice carried. */
export const FLAdresswechselStoppPayloadSchema = z.object({
  token: adresswechselToken,
});

// ---- The address tool: admin tier ----------------------------------------------------------------

/** The tool's read: exactly one key, the address typed or a change's id from a link. */
export const FLAdresswechselVerwaltungAnsichtPayloadSchema = z
  .object({
    // Nullable as well as optional, as the backend's: it reads a null key as an absent one, so the one-key check below does too.
    adresse: KontaktEmailSchema.nullable().optional(),
    adresswechsel_id: CustomObjectIdStringSchema.nullable().optional(),
  })
  .refine(({ adresse, adresswechsel_id }) => (adresse == null) !== (adresswechsel_id == null), {
    error: "Gib eine E-Mail-Adresse ein.",
  });

/**
 * The start's draft, for a person who says they cannot sign in. `grund` null asks the address on file to approve
 * first; a reason starts the waiting time.
 */
export const FLAdresswechselVerwaltungPayloadSchema = z.object({
  adresse: KontaktEmailSchema,
  email: KontaktEmailSchema,
  grund: AdresswechselGrundSchema.nullable(),
});

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
