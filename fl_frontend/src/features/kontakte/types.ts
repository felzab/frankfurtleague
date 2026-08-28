import type { SaisonTeamKontakteDraft } from "@/features/teams/types";
import type { FLPatchSaisonTeamKontaktePayload } from "./schemas";

/**
 * The payload mid-edit, widened to what a half-filled seat holds: an unpicked Einwilligung is `null`
 * until somebody says whose word it is on. The schema refuses that null, so an untouched chip group
 * is a field error rather than a consent nobody gave.
 */
export type SaisonTeamKontaktePayloadDraft = Omit<FLPatchSaisonTeamKontaktePayload, "kontakte"> & {
  kontakte: SaisonTeamKontakteDraft | null;
};
