import { redirect } from "next/navigation";

import { rolesOf } from "@/core/roles";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SchiedsrichterSelfView } from "@/features/schiedsrichter/components/views/SchiedsrichterSelfView";
import { getSchiedsrichterSelf } from "@/features/schiedsrichter/queries";
import { getSchiedsrichterSpielberichte } from "@/features/spielberichte/queries";
import { getEigeneSpielbestaetigungen } from "@/features/spielbestaetigungen/queries";
import { isFunktionLost } from "@/shared/utils/actionError";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SchiedsrichterSpielberichte } from "@/features/spielberichte/types";

export default async function PersoenlichSchiedsrichterPage() {
  const subject = await requireSubjectSession();

  // To the landing rather than a 404: the address exists, and the landing sends a person on to
  // whatever they do hold.
  if (!rolesOf(subject).roles.some((funktion) => funktion.art === "schiedsrichter")) {
    logPageVerweigert("/bereich/schiedsrichter", "keine_funktion");
    redirect("/bereich");
  }

  let selbst, einsaetze, spielberichte;
  try {
    // Side by side: no read waits on another, and each answers the same lost record alike.
    [selbst, einsaetze, spielberichte] = await Promise.all([
      getSchiedsrichterSelf(),
      getEigeneSpielbestaetigungen(),
      // A failed report read is its section's own state, so the answers to an Einteilung stand; a lost record still
      // lands through the two reads beside it.
      runWithIncomingTrace(() =>
        getSchiedsrichterSpielberichte().then(
          (gelesen): SchiedsrichterSpielberichte => ({ spiele: gelesen.spiele, earlier: gelesen.earlier }),
          (error: unknown): SchiedsrichterSpielberichte => nullUnlessContractBreak(error) ?? "unlesbar",
        ),
      ),
    ]);
  } catch (error) {
    // The row went between the page's own check and the backend's, which is the check above failing
    // late: the same landing. Every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    redirect("/bereich");
  }

  return (
    <SchiedsrichterSelfView
      schiedsrichter={selbst.schiedsrichter}
      einsaetze={einsaetze.spielbestaetigungen}
      spielberichte={spielberichte}
    />
  );
}
