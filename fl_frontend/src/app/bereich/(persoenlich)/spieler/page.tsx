import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { getSubjectSession } from "@/core/subject";
import { EmptyState } from "@/shared/components/ui/EmptyState";

export default async function PersoenlichSpielerPage() {
  await connection();
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/layout.tsx :: PersonChrome` gives.
  if (subject === null) return null;

  // To the landing rather than a 404, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/schiedsrichter/page.tsx` gives.
  if (!funktionenOf(subject).funktionen.some((funktion) => funktion.art === "spieler")) redirect("/bereich");

  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <EmptyState title="Du bist als Spieler eingetragen." />
      </div>
    </div>
  );
}
