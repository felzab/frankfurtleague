import { connection } from "next/server";

import { requireSubjectSession } from "../../resolvers";

/**
 * A person's lane only, and it must WRAP what it guards, as `AdminAuthGuard` does. Never above
 * `/bereich/admin`: an administrator's render reads `getAdminSession` alone.
 */
export async function FunktionenGuard({ children }: { children: React.ReactNode }) {
  // For this read alone: the builder stage reaches no sign-in store, and each part of the frame
  // beside this awaits its own, so no read depends on where this guard is mounted.
  await connection();
  // The page's turn-away, held apart from the frame as `AdminAuthGuard` is. The frame's reads are
  // the same memoised call, so this costs no read.
  await requireSubjectSession();

  return <>{children}</>;
}
