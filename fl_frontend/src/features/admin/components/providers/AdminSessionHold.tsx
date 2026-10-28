import { connection } from "next/server";

import { judgeAdminRequest } from "@/core/auth";
import { UnreadGrantError } from "@/core/errors";
import { confirmedUntil } from "@/shared/utils/kontoMutation";

import { AdminStepUpProvider } from "./AdminStepUpProvider";

// In the layout's `Suspense`, never the layout, which would go fully dynamic.
/**
 * Holds the admin page slot until the session is judged, and never redirects: a redirect thrown in the frame unmounts
 * it whole, so each page's own read turns a refused session away.
 */
export async function AdminSessionHold({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the
  // image build.
  await connection();
  const judged = await judgeAdminRequest();
  if ("refused" in judged) {
    // An outage keeps the administrator in place with the admin boundary's retry, as
    // `fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead` answers it: a sign-in meets the same unread grant.
    if (judged.refused === "unread") throw new UnreadGrantError();
    // Bare, with no step-up to offer: the page's own `runAdminRead` sends the session to the sign-in landing.
    return <>{children}</>;
  }
  const served = judged.session;

  // Read off the session this render already holds, so a step-up press asks before it sends
  // rather than after the server refuses it.
  return <AdminStepUpProvider served={{ ...confirmedUntil(served), inhaberId: served.user.id }}>{children}</AdminStepUpProvider>;
}
