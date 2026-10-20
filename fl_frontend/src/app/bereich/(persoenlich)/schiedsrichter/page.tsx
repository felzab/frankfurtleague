import { redirect } from "next/navigation";
import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { funktionenOf } from "@/core/funktionen";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SchiedsrichterSelbstView } from "@/features/schiedsrichter/components/views/SchiedsrichterSelbstView";
import { getSchiedsrichterSelbst } from "@/features/schiedsrichter/queries";
import { getSchiedsrichterSpielberichte } from "@/features/spielberichte/queries";
import { getEigeneSpielbestaetigungen } from "@/features/spielbestaetigungen/queries";
import { isFunktionLost } from "@/shared/utils/actionError";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SchiedsrichterSpielberichte } from "@/features/spielberichte/types";

export default async function PersoenlichSchiedsrichterPage() {
  await connection();
  const subject = await requireSubjectSession();

  // To the landing rather than a 404: the address exists, and the landing sends a person on to
  // whatever they do hold.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "schiedsrichter")) {
    logPageVerweigert("/bereich/schiedsrichter", "keine_funktion");
    redirect("/bereich");
  }

  let selbst, einsaetze, spielberichte;
  try {
    // Side by side: no read waits on another, and each answers the same lost record alike. Nothing is read while the
    // reports are closed: their section then says why it offers no fixture. A failed report read is its section's own
    // state, so the answers to an Einteilung stand; a lost record still lands through the two reads beside it.
    [selbst, einsaetze, spielberichte] = await Promise.all([
      getSchiedsrichterSelbst(),
      getEigeneSpielbestaetigungen(),
      frontend_config.SPIELBERICHT_EINGABE === "on"
        ? runWithIncomingTrace(() =>
            getSchiedsrichterSpielberichte().then(
              (gelesen): SchiedsrichterSpielberichte => gelesen.spiele,
              (error: unknown): SchiedsrichterSpielberichte => nullUnlessContractBreak(error) ?? "unlesbar",
            ),
          )
        : ("geschlossen" as const),
    ]);
  } catch (error) {
    // The row went between the page's own check and the backend's, which is the check above failing
    // late: the same landing. Every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    redirect("/bereich");
  }

  return (
    <SchiedsrichterSelbstView
      schiedsrichter={selbst.schiedsrichter}
      einsaetze={einsaetze.spielbestaetigungen}
      spielberichte={spielberichte}
    />
  );
}
