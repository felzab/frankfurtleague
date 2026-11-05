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
