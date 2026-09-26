import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { FunktionenView } from "@/features/funktionen/components/views/FunktionenView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { zieleOf } from "@/features/funktionen/utils";

/** Where a signed-in person lands, and the switch between everything they hold. */
export default async function PersoenlichStartPage() {
  await connection();
  const subject = await requireSubjectSession();

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
