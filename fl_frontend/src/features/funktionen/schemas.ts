// Redesign: goes with its last importer.
import z from "zod";

import { ADRESSE_IM_GRUND_REGEX } from "@/features/sperrliste/schemas";
import { addressSchema, singleLineName } from "@/shared/schemas";

import { LOESCHUNG_ANLASS_MAX_LENGTH } from "./constants";

/**
 * The address the erasure, its reveal and the sign-out look up, held to no address rule as the API's lookup is: a
 * record stored under an older rule stays erasable. The forms check it before the press, the actions again.
 */
export const FLLoeschungAdressePayloadSchema = z.object({ email: addressSchema((address) => address.includes("@")) });

/** The erasure's draft: the address, and the request the erasure answers, which every log row it files keeps. */
export const FLLoeschungPayloadSchema = FLLoeschungAdressePayloadSchema.extend({
  // Trimmed before either bound counts it, as the API is, so a box of spaces is refused in German.
  anlass: singleLineName(
    z
      .string({ error: "Bitte gib einen Anlass ein." })
      .trim()
      .nonempty({ error: "Bitte gib einen Anlass ein." })
      .max(LOESCHUNG_ANLASS_MAX_LENGTH, { error: `Der Anlass darf höchstens ${String(LOESCHUNG_ANLASS_MAX_LENGTH)} Zeichen lang sein.` }),
    "Der Anlass",
  )
    // The log row outlives the erasure by a year, and no redaction reaches its `anlass`.
    .refine((anlass) => !ADRESSE_IM_GRUND_REGEX.test(anlass), { error: "Der Anlass darf keine E-Mail-Adresse enthalten." }),
});
