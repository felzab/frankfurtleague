import z from "zod";

import { FLKontaktRolleSchema } from "@/features/bewerbungen/schemas";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { FLSaisonTeamKontaktePayloadSchema } from "@/features/teams/schemas";
import { CustomObjectIdStringSchema } from "@/shared/schemas";

/**
 * The contacts save's input: the three seats and the token naming which block they were composed
 * against, beside the row's natural key. `FLSaisonTeamKontaktePayloadSchema` is reused: the junction
 * PATCH takes the same block, and a second spelling would drift with nothing able to see it.
 */
export const FLPatchSaisonTeamKontaktePayloadSchema = z.object({
  // Both ids are in the PATH on the wire — the junction row is addressed by its natural key. They
  // are carried here because the form has to know which club's season it is writing.
  team_id: CustomObjectIdStringSchema,
  saison_id: z.string().length(SAISON_ID_LENGTH, { error: `Die Saison-ID besteht aus genau ${String(SAISON_ID_LENGTH)} Zeichen.` }),
  // The whole block, or `null` to clear it. REQUIRED with no default: a form that omits it gets a
  // 422, never three people quietly left standing.
  kontakte: FLSaisonTeamKontaktePayloadSchema.nullable(),
  // Echoed back exactly as the read served it (`REQ-KONTAKT-001`). Unbounded on purpose: a token no
  // read minted is refused there anyway, and a bound here would mark a box nothing renders.
  kontakte_stand: z.string(),
});
export type FLPatchSaisonTeamKontaktePayload = z.infer<typeof FLPatchSaisonTeamKontaktePayloadSchema>;

/** Which seat of which season row the re-send names. All three travel in the path, so the request carries no body. */
export const FLKontaktEinladenPayloadSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  saison_id: FLPatchSaisonTeamKontaktePayloadSchema.shape.saison_id,
  rolle: FLKontaktRolleSchema,
});
