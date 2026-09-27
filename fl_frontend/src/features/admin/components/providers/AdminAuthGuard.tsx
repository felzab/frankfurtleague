import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import { SIGN_IN_LANDING } from "@/core/signInLanding";
import { enrolmentUntil, freshUntil } from "@/shared/utils/kontoMutation";

import { AdminStepUpProvider } from "./AdminStepUpProvider";

/**
 * Admin-only `children`, and it must WRAP them: as a sibling the page's own hole could stream before
 * the check resolved. It sits in the layout's `Suspense`, not the layout, which would go fully dynamic.
 */
export async function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the
  // image build.
  await connection();
  // The grant's check, which `proxy.ts` leaves to this guard (`docs/frontend/spec.md :: I243`): to the
  // landing, which sends a person home and an unread grant to its outage panel.
  const served = await getAdminSession();
  if (!served) redirect(SIGN_IN_LANDING);

  // Read off the session this render already holds, so a step-up press asks before it sends
  // rather than after the server refuses it (`docs/frontend/spec.md :: I433`).
  return (
    <AdminStepUpProvider served={{ freshUntil: freshUntil(served), enrolmentUntil: enrolmentUntil(served), inhaberId: served.user.id }}>
      {children}
    </AdminStepUpProvider>
  );
}
