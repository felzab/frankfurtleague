import { redirect } from "next/navigation";

import { UnreadGrantError } from "@/core/errors";
import { SIGN_IN_LANDING } from "@/core/signInLanding";

import { runWithIncomingTrace } from "./traceScope";

/**
 * Runs one admin-tier read with the administrator it is made for recorded as the request's actor, the
 * backend refusing an admin-tier request that names nobody (`docs/backend/spec.md :: I41`).
 */
export async function runAdminRead<T>(fn: () => Promise<T>): Promise<T> {
  return runWithIncomingTrace(async () => {
    // Loaded at the call: every slice's `queries.ts` imports this module, public pages among their
    // readers, and a static import would put the sign-in store in each of their graphs.
    const { judgeAdminRequest } = await import("@/core/auth");
    // Inside the scope just opened, where the guard records its actor on every call, memoised or not,
    // and refuses one that is not the signed-in administrator.
    const judged = await judgeAdminRequest();
    if ("refused" in judged) {
      // An outage stays on its page, whose boundary retries, as an admin write answers it with a retry.
      if (judged.refused === "unread") throw new UnreadGrantError();
      // The admin pages' own check, answered as `AdminAuthGuard` answers: Next renders a page whatever its
      // layout's guard decides, and a soft navigation no layout at all (`docs/frontend/spec.md :: I122`).
      redirect(SIGN_IN_LANDING);
    }

    return fn();
  });
}
