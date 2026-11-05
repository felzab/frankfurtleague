import { redirect } from "next/navigation";

import { rolesOf } from "@/core/roles";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SpielerSelfView } from "@/features/spieler/components/views/SpielerSelfView";
import { getSpielerSelf } from "@/features/spieler/queries";
import { isFunktionLost } from "@/shared/utils/actionError";

export default async function PersoenlichSpielerPage() {
  const subject = await requireSubjectSession();

  // To the landing rather than a 404, for the reason
  // `fl_frontend/src/app/area/(persoenlich)/schiedsrichter/page.tsx` gives.
  if (!rolesOf(subject).roles.some((funktion) => funktion.kind === "spieler")) {
    logPageVerweigert("/area/spieler", "no_role");
    redirect("/area");
  }

  let selbst;
  try {
    selbst = await getSpielerSelf();
  } catch (error) {
    // The row went between the page's own check and the backend's, which is the check above failing
    // late: the same landing. Every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    redirect("/area");
  }

  return <SpielerSelfView spieler={selbst.spieler} />;
}
