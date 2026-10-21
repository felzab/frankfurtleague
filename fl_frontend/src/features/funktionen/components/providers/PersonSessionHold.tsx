import { connection } from "next/server";

import { getSubjectSession } from "@/core/subject";

// A person's lane only, never above `/bereich/admin`: an administrator's render reads `getAdminSession` alone.
/**
 * Holds the page slot until the session is read, and never redirects: a redirect thrown in the frame unmounts it
 * whole, so the page's own `requireSubjectSession` turns a lapsed session away (`docs/frontend/spec.md :: I834`).
 */
export async function PersonSessionHold({ children }: { children: React.ReactNode }) {
  // For this read alone: the builder stage reaches no sign-in store, and each part of the frame
  // beside this awaits its own, so no read depends on where this is mounted.
  await connection();
  // The frame's and the page's own read, memoised per render, so holding costs no read.
  await getSubjectSession();

  return <>{children}</>;
}
