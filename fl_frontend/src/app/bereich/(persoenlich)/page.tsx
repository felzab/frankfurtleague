import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getSignInDestination } from "@/core/auth";
import { funktionenOf } from "@/core/funktionen";
import { FunktionenView } from "@/features/funktionen/components/views/FunktionenView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { zieleOf } from "@/features/funktionen/utils";

/** Where a signed-in person lands, and the switch between everything they hold. */
export default async function PersoenlichStartPage() {
  await connection();
  const subject = await requireSubjectSession();

  // An allowlisted address past the administrator's window, or short of the passkey, is no person:
  // the admin subtree's proxy takes it through the step it owes (`docs/frontend/spec.md :: I386`).
  // eslint-disable-next-line local/admin-link -- the proxy turns this request away before any season is read
  if (!subject.admin && (await getSignInDestination()) !== "/bereich") redirect("/bereich/admin");

  const { funktionen, unbestaetigt } = funktionenOf(subject);
  const ziele = zieleOf(funktionen);
  const [erstes, ...weitere] = ziele;

  if (erstes === undefined) return <FunktionenView zustand={unbestaetigt ? "unbestaetigt" : "leer"} />;

  // One address is no choice to offer, however many Funktionen lead to it.
  if (weitere.length === 0) redirect(erstes.href);

  return (
    <FunktionenView
      zustand="auswahl"
      ziele={ziele}
    />
  );
}
