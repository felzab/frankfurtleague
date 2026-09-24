import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getCurrentSaisonOrNull } from "@/features/saisons/queries";

/**
 * The admin pages passing an omitted season to a backend read, which answers 404 while none runs. The
 * state is refused here, once for all of them, rather than rendered by each (`docs/frontend/spec.md :: I359`).
 */
export default async function CurrentSaisonLayout({ children }: { children: React.ReactNode }) {
  // The builder stage has no reachable backend, so a read resolved at build time fails the image build.
  await connection();

  // The running season alone, never the season list (`.claude/rules/frontend.md` **saisons**), and a
  // page naming a planned season is sent on too.
  // eslint-disable-next-line no-restricted-syntax -- a layout is handed no `?saison_id=` to read or carry
  if ((await getCurrentSaisonOrNull()) === null) redirect("/admin/saisons");

  return <>{children}</>;
}
