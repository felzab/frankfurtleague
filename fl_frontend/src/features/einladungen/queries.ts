import { cache } from "react";

import { saisonsGetInvitationsDispatchPreview, teamsGetInvitation } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLInvitationDispatchPreviewResponse, FLInvitationResponse } from "@/core/generated/client/types";

/**
 * **Never `"use cache"` here**: `laeuft` is judged against today, so a cached answer would go on
 * reporting an open window long after it shut.
 */
// `cache` memoizes per RENDER PASS.
export const getEinladung = cache(async (teamId: string, saisonId: string): Promise<FLInvitationResponse> =>
  runAdminRead(() => teamsGetInvitation(teamId, saisonId)),
);

/**
 * **`erneut` rides along**: a team already mailed reads as skipped with it false and is written to
 * with it true, so a list read without the value the press will carry describes a different press.
 */
export async function getEinladungVersandVorschau(saisonId: string, erneut: boolean): Promise<FLInvitationDispatchPreviewResponse> {
  return runAdminRead(() => saisonsGetInvitationsDispatchPreview(saisonId, { resend: erneut }));
}
