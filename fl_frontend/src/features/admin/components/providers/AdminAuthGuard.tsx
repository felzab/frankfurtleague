import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import { freshUntil } from "@/shared/utils/kontoMutation";

import { AdminStepUpProvider } from "./AdminStepUpProvider";

/**
 * Admin-only `children`, and it must WRAP them: as a sibling the page's own hole could stream before
 * the check resolved. It sits in the layout's `Suspense`, not the layout, which would go fully dynamic.
 */
export async function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the
  // image build.
  await connection();
  // Second layer: `proxy.ts` turns an unauthenticated `/bereich/admin/*` away first (`docs/frontend/spec.md :: I243`,
  // `:: I251`). Narrow its matcher and this still redirects, but from inside the stream — a 200 whose shell
  // already went.
  const served = await getAdminSession();
  if (!served) redirect("/signin");

  // Read off the session this render already holds, so a step-up press asks before it sends
  // rather than after the server refuses it (`docs/frontend/spec.md :: I433`).
  return <AdminStepUpProvider served={{ confirmedUntil: freshUntil(served) }}>{children}</AdminStepUpProvider>;
}
