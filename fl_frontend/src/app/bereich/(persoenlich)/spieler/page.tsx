import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SpielerSelbstView } from "@/features/spieler/components/views/SpielerSelbstView";
import { getSpielerSelbst } from "@/features/spieler/queries";
import { isFunktionLost } from "@/shared/utils/actionError";

export default async function PersoenlichSpielerPage() {
  await connection();
  const subject = await requireSubjectSession();

  // To the landing rather than a 404, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/schiedsrichter/page.tsx` gives.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "spieler")) {
    logPageVerweigert("/bereich/spieler", "keine_funktion");
    redirect("/bereich");
  }

  let selbst;
  try {
    selbst = await getSpielerSelbst();
  } catch (error) {
    // The row went between the page's own check and the backend's, which is the check above failing
    // late: the same landing. Every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    redirect("/bereich");
  }

  return <SpielerSelbstView spieler={selbst.spieler} />;
}
