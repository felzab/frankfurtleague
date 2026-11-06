// Redesign: goes with its last importer.
import z from "zod";

import { FLGruppenNames, FLSchulform, FLTrainerAlso, FLTrikotFarbe } from "@/core/generated/client/types";

// The old application form's judgement of its draft, in words a person reads, before its action sends the write
// through the generated client.

/** A closed set. German error because the group picker binds this schema, and an untouched picker submits null. */
export const FLGruppenNamesSchema = z.enum(FLGruppenNames, { error: "Bitte wähle eine Gruppe." });

/**
 * No German error: the club editor offers `Keine Angabe` beside the six, so an unanswered picker is a null the field
 * accepts rather than a refusal.
 */
const FLSchulformSchema = z.enum(FLSchulform, {
  // Named rather than enumerated: the picker is already showing the six, and Zod's own default
  // answers a person by listing the slugs the wire uses.
  error: "Bitte wähle eine Schulform.",
});

/**
 * The league's kit palette. The slug is what travels; its German name and its swatch are
 * `fl_frontend/src/features/teams/constants.ts :: TRIKOT_FARBE_OPTIONS`.
 */
export const FLTrikotFarbeSchema = z.enum(FLTrikotFarbe, {
  // Named rather than enumerated, for `FLSchulformSchema`'s reason: a list of slugs is not an answer.
  error: "Bitte wähle eine Trikotfarbe.",
});

/**
 * Which OTHER seat the Trainer also holds. One nullable field rather than two flags, which would let a row claim both
 * seats at once.
 */
const FLTrainerZugleichSchema = z.enum(FLTrainerAlso, {
  error: "Bitte wähle, wer zugleich Trainerin oder Trainer ist.",
});
