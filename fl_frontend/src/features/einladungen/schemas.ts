// Redesign: goes with its last importer.
import z from "zod";

import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * Which team's invite, in a season. Both ids travel in the PATH on the wire; they are carried here
 * because the action has to know whose invite it is minting.
 */
export const FLEinladungKeyPayloadSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
});

/** The live invite the panel shows, so a link replaced or withdrawn since is refused rather than another one mailed. */
export const EinladungMailenEingabeSchema = FLEinladungKeyPayloadSchema.extend({
  einladung_id: CustomObjectIdStringSchema,
});

/**
 * **One payload for the preview AND the press**: a shape carrying the re-send choice to one of them
 * alone is how a page comes to list one set of teams and write to another.
 */
export const FLEinladungVersandPayloadSchema = z.object({
  // The season travels in the PATH on the wire; it is carried here because both calls have to name
  // the season they were pressed on.
  id: z.string().length(SAISON_ID_LENGTH, { error: "Bitte wähle eine Saison." }),
  // Optional because the endpoint defaults it, which on a REQUEST is what optional means: a body
  // without the key mails nobody twice, the failure a bulk control has and a per-team one does not.
  erneut: z.boolean().optional(),
});
