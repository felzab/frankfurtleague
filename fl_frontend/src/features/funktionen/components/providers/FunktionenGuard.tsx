import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getSubjectSession } from "@/core/subject";

/**
 * A person's lane only, and it must WRAP what it guards, as `AdminAuthGuard` does. Never above
 * `/bereich/admin`: an administrator's render reads `getAdminSession` alone.
 */
export async function FunktionenGuard({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the
  // image build.
  await connection();
  // The only layer: `proxy.ts` judges `/bereich/admin` alone, and a session past either person
  // lifetime reaches here as `null` (`docs/frontend/spec.md :: I377`).
  if (!(await getSubjectSession())) redirect("/signin");

  return <>{children}</>;
}
