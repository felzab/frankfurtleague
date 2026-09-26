import { connection } from "next/server";

import { requireSubjectSession } from "../../resolvers";

/**
 * A person's lane only, and it must WRAP what it guards, as `AdminAuthGuard` does. Never above
 * `/bereich/admin`: an administrator's render reads `getAdminSession` alone.
 */
export async function FunktionenGuard({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable Mongo, so a session lookup resolved at build time fails the
  // image build.
  await connection();
  // For the shell, which a page's own read cannot reach: `proxy.ts` judges `/bereich/admin` alone
  // (`docs/frontend/spec.md :: I377`).
  await requireSubjectSession();

  return <>{children}</>;
}
