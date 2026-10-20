import { redirect } from "next/navigation";
import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { funktionenOf } from "@/core/funktionen";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SchiedsrichterSelbstView } from "@/features/schiedsrichter/components/views/SchiedsrichterSelbstView";
import { getSchiedsrichterSelbst } from "@/features/schiedsrichter/queries";
import { getSchiedsrichterSpielberichte } from "@/features/spielberichte/queries";
import { isFunktionLost } from "@/shared/utils/actionError";

export default async function PersoenlichSchiedsrichterPage() {
  await connection();
  const subject = await requireSubjectSession();

  // To the landing rather than a 404: the address exists, and the landing sends a person on to
  // whatever they do hold.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "schiedsrichter")) {
    logPageVerweigert("/bereich/schiedsrichter", "keine_funktion");
    redirect("/bereich");
  }

  let selbst;
  let spielberichte;
  try {
    // Nothing read while the reports are closed: the section then says why it offers no fixture.
    [selbst, spielberichte] = await Promise.all([
      getSchiedsrichterSelbst(),
      frontend_config.SPIELBERICHT_EINGABE === "on" ? getSchiedsrichterSpielberichte() : null,
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
      spielberichte={spielberichte?.spiele ?? null}
    />
  );
}
