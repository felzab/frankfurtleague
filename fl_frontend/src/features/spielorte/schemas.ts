import z from "zod";

import { CustomObjectIdStringSchema, FLAddressPayloadSchema } from "@/shared/schemas";

// Redesign: goes with its last importer.
/** Shared by create and patch, which mirror one backend class: the patch replaces the venue wholesale. */
const spielortPayloadFields = {
  // Trimmed before the floor counts it, as `fl_backend/app/api/spielorte/schemas.py :: _SpielortPayload`
  // is: the API refuses a name of spaces alone with a `payload_refused` marking the box with a generic
  // sentence, so a looser mirror loses the floor's German.
  name: z.string().trim().nonempty({ error: "Bitte gib einen Namen ein." }),
  default_mietpreis: z
    .int({ error: "Bitte gib einen Standard-Mietpreis ein." })
    .nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
  address: FLAddressPayloadSchema,
};

// Redesign: goes with its last importer.
export const FLPostSpielortPayloadSchema = z.object(spielortPayloadFields);
export type FLPostSpielortPayload = z.infer<typeof FLPostSpielortPayloadSchema>;

// Redesign: goes with its last importer.
export const FLPatchSpielortPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  ...spielortPayloadFields,
});
export type FLPatchSpielortPayload = z.infer<typeof FLPatchSpielortPayloadSchema>;

// Redesign: goes with its last importer.
/** Widened at the money field: an emptied box holds `null`, which the schema above refuses at the submit. */
export type FLSpielortPayloadDraft<T extends { default_mietpreis: number }> = Omit<T, "default_mietpreis"> & {
  default_mietpreis: number | null;
};

// Redesign: goes with its last importer.
/** The retire and reactivate calls: an id in the path, no request body. */
export const FLSpielortKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLSpielortKeyPayload = z.infer<typeof FLSpielortKeyPayloadSchema>;
