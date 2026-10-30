import z from "zod";

// The applications slice declares the width every minted token is bounded by, one mint function
// serving both flows (`fl_backend/app/api/bewerbungen/services.py :: mint_token`); a literal beside
// it is compared by nothing.
import { BEWERBUNG_TOKEN_MAX_LENGTH } from "@/features/bewerbungen/constants";
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

/**
 * **The raw link value is the panel's to hand back**: the store keeps a hash alone, so the mint's
 * own answer is the only place it exists, and a message composed after a reload would carry none.
 */
export const FLEinladungMailPayloadSchema = FLEinladungKeyPayloadSchema.extend({
  einladung_id: CustomObjectIdStringSchema,
  token: z
    .string()
    .trim()
    // German though the panel offers no box for it: a payload refused here reaches the log rather
    // than a field.
    .nonempty({ error: "Diese Einladung nennt keinen Link." })
    .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: "Dieser Link ist zu lang." }),
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
