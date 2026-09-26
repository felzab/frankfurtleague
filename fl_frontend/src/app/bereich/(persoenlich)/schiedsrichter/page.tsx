import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { SchiedsrichterLeerView } from "@/features/funktionen/components/views/SchiedsrichterLeerView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";

export default async function PersoenlichSchiedsrichterPage() {
  await connection();
  const subject = await requireSubjectSession();

  // To the landing rather than a 404: the address exists, and the landing sends a person on to
  // whatever they do hold.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "schiedsrichter")) redirect("/bereich");

  return <SchiedsrichterLeerView />;
}
