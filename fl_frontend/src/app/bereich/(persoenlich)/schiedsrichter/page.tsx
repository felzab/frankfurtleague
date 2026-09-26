import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { SchiedsrichterLeerView } from "@/features/funktionen/components/views/SchiedsrichterLeerView";

export default async function PersoenlichSchiedsrichterPage() {
  await connection();
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/layout.tsx :: PersonChrome` gives.
  if (subject === null) return null;

  // To the landing rather than a 404: the address exists, and the landing sends a person on to
  // whatever they do hold.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "schiedsrichter")) redirect("/bereich");

  return <SchiedsrichterLeerView />;
}
