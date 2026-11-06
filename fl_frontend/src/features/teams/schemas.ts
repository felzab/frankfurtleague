// Redesign: goes with its last importer.
import z from "zod";

import { FLGruppenNames, FLTrikotFarbe } from "@/core/generated/client/types";

// The old application form's judgement of its draft, in words a person reads, before its action sends the write
// through the generated client.

/** A closed set. German error because the group picker binds this schema, and an untouched picker submits null. */
export const FLGruppenNamesSchema = z.enum(FLGruppenNames, { error: "Bitte wähle eine Gruppe." });

/**
 * The league's kit palette. The slug is what travels; its German name and its swatch are
 * `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`.
 */
export const FLTrikotFarbeSchema = z.enum(FLTrikotFarbe, {
  // Named rather than enumerated: a list of slugs is not an answer.
  error: "Bitte wähle eine Trikotfarbe.",
});
