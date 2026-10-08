import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { logPageVerweigert } from "@/features/funktionen/verweigert";
import { SchiedsrichterSelbstView } from "@/features/schiedsrichter/components/views/SchiedsrichterSelbstView";
import { getSchiedsrichterSelbst } from "@/features/schiedsrichter/queries";
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
  try {
    selbst = await getSchiedsrichterSelbst();
  } catch (error) {
    // The row went between the page's own check and the backend's, which is the check above failing
    // late: the same landing. Every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    redirect("/bereich");
  }

  return <SchiedsrichterSelbstView schiedsrichter={selbst.schiedsrichter} />;
}
