import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { FunktionenView } from "@/features/funktionen/components/views/FunktionenView";
import { zieleOf } from "@/features/funktionen/utils";

/** Where a signed-in person lands, and the switch between everything they hold. */
export default async function PersoenlichStartPage() {
  await connection();
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/layout.tsx :: PersonChrome` gives.
  if (subject === null) return null;

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
