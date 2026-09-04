import type { SaisonTeamKontakteDraft } from "@/features/teams/types";
import type { FLPatchSaisonTeamKontaktePayload } from "./schemas";

/**
 * The payload mid-edit, holding what the editor read rather than what it sends: a seat's stored
 * `erteilt_von` and `bestaetigt_am` are on no payload, so the schema strips them silently instead of
 * refusing them.
 */
export type SaisonTeamKontaktePayloadDraft = Omit<FLPatchSaisonTeamKontaktePayload, "kontakte"> & {
  kontakte: SaisonTeamKontakteDraft | null;
};
