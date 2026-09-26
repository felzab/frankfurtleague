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
  // The lane's turn-away, held apart from the chrome as `AdminAuthGuard` is: `proxy.ts` judges
  // `/bereich/admin` alone. The chrome's read below is the same memoised call, so this costs no read.
  await requireSubjectSession();

  return <>{children}</>;
}
