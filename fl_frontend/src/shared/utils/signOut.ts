import "client-only";

import { postPublicForm } from "@/shared/utils/publicSubmit";

import type { SignOutResult } from "@/shared/types/types";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";

/** The route handler that ends the session (`fl_frontend/src/app/api/signout/route.ts`). */
const SIGN_OUT_ENDPOINT = "/api/signout";

/** Ends the session this browser holds, through a route rather than a server action, for the reason the route states. */
export async function signOut(): Promise<SignOutResult> {
  const sent = await postPublicForm<PublicEnvelope & SignOutResult>(SIGN_OUT_ENDPOINT, {});
  if (sent.answered) return sent.body;

  // Only the edge's own rate refusal wrote nothing: any other answer that was not this application's may have
  // reached it and ended the session.
  return sent.wroteNothing ? { success: false, error: sent.error } : { success: false, error: sent.error, outcome: "unknown" };
}
