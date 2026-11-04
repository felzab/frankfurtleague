import { redirect } from "next/navigation";

import { judgeAdminRequest } from "@/core/auth/guards";
import { UnreadGrantError } from "@/core/errors";
import { ROUTES } from "@/core/routes";

import { runWithIncomingTrace } from "./traceScope";

/**
 * The admin pages' own check, and their one turn-away: the layout redirects nobody, a redirect there unmounting the
 * whole frame, and a soft navigation renders no layout at all.
 */
export async function requireAdminRequest(): Promise<void> {
  const judged = await judgeAdminRequest();
  if (!("refused" in judged)) return;

  // An outage stays on its page, whose boundary retries, as an admin write answers it with a retry.
  if (judged.refused === "unread") throw new UnreadGrantError();
  redirect(ROUTES.signInLanding.path());
}

/**
 * Runs one admin-tier read with the administrator it is made for recorded as the request's actor, the
 * backend refusing an admin-tier request that names nobody.
 */
export async function runAdminRead<T>(fn: () => Promise<T>): Promise<T> {
  return runWithIncomingTrace(async () => {
    // Inside the scope just opened, where the check records its actor on every call, memoised or not.
    await requireAdminRequest();

    return fn();
  });
}
