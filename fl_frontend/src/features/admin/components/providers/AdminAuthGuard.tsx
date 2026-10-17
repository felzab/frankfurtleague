import { redirect } from "next/navigation";
import { connection } from "next/server";

import { judgeAdminRequest } from "@/core/auth";
import { UnreadGrantError } from "@/core/errors";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { confirmedUntil } from "@/shared/utils/kontoMutation";

import { AdminStepUpProvider } from "./AdminStepUpProvider";

/**
 * Admin-only `children`, WRAPPED so nothing under it shows before the check; it stops no page rendering,
 * each page's own reads turning the session away (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
 * In the layout's `Suspense`, never the layout, which would go fully dynamic.
 */
export async function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the
  // image build.
  await connection();
  // The grant's check, which `proxy.ts` leaves to every guard (`docs/frontend/spec.md :: I243`).
  const judged = await judgeAdminRequest();
  if ("refused" in judged) {
    // An outage keeps the administrator in place with the admin boundary's retry, as
    // `fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead` answers it: a sign-in meets the same unread grant.
    if (judged.refused === "unread") throw new UnreadGrantError();
    // To the landing, which sends a person home and a lapsed administrator to sign in.
    redirect(SIGN_IN_LANDING);
  }
  const served = judged.session;

  // Read off the session this render already holds, so a step-up press asks before it sends
  // rather than after the server refuses it (`docs/frontend/spec.md :: I433`).
  return <AdminStepUpProvider served={{ ...confirmedUntil(served), inhaberId: served.user.id }}>{children}</AdminStepUpProvider>;
}
