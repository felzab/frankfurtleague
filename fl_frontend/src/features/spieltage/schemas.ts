// Redesign: goes with its last importer.
import z from "zod";

import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

// The old matchday form's own judgement of its draft, in words an administrator reads, before its action sends the
// write through the generated client, which types the body against the write's published contract.

// The message names `ende`, the field to fix.
const endsAfterItBegins = {
  error: "Das Ende darf nicht vor dem Beginn liegen.",
  path: ["ende"],
};

/**
 * The dates alone, and **both are required here where the read model holds them nullable**: an
 * undated matchday is one nobody has dated yet, and dating one means supplying the whole span.
 */
export const FLPatchSpieltagPayloadSchema = z
  .object({
    // In the PATH on the wire; here because the form has to know which matchday it is saving.
    id: CustomObjectIdStringSchema,
    beginn: CustomDateStringSchema,
    ende: CustomDateStringSchema,
  })
  .refine((spieltag) => spieltag.ende >= spieltag.beginn, endsAfterItBegins);

/**
 * The same payload with the season's own span folded in, mirroring `REQ-DATE-002`. A FACTORY because the span is
 * the edited season's rather than a constant, and a rule the schema holds is judged on the blur.
 */
export function buildPatchSpieltagPayloadSchema(saisonSpan?: { start: string; end: string }) {
  if (saisonSpan === undefined) return FLPatchSpieltagPayloadSchema;

  const withinSaison = (datum: string) => datum >= saisonSpan.start && datum <= saisonSpan.end;

  return FLPatchSpieltagPayloadSchema.refine((spieltag) => withinSaison(spieltag.beginn), {
    error: "Wähle einen Tag innerhalb der Saison.",
    path: ["beginn"],
  }).refine((spieltag) => withinSaison(spieltag.ende), {
    error: "Wähle einen Tag innerhalb der Saison.",
    path: ["ende"],
  });
}
