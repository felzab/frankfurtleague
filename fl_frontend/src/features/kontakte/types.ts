import type { SaisonTeamKontakteDraft } from "@/features/teams/types";
import type { FLKontaktErasureAnsichtResponse, FLPatchSaisonTeamKontaktePayload } from "./schemas";

/**
 * What a person's erasure panel learned from its arming read, carried WITH the address it asked about:
 * the seat's own boxes stay live while the panel is armed, so an answer read for one address must not
 * stand under another.
 */
export type ErasureAnsicht = { email: string } & (
  { status: "reading" } | { status: "read"; sitze: FLKontaktErasureAnsichtResponse } | { status: "refused"; reason: string }
);

/**
 * The payload mid-edit, holding what the editor read rather than what it sends: a seat's stored
 * `erfasst_von` and `bestaetigt_am` are on no payload, so the schema strips them silently instead of
 * refusing them.
 */
export type SaisonTeamKontaktePayloadDraft = Omit<FLPatchSaisonTeamKontaktePayload, "kontakte"> & {
  kontakte: SaisonTeamKontakteDraft | null;
};
