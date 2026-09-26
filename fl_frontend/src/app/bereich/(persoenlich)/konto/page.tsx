import { connection } from "next/server";

import { getSubjectSession } from "@/core/subject";
import { SicherheitSection } from "@/features/konto/components/views/SicherheitSection";
import { KontoPanel } from "@/shared/components/ui/KontoPanel";

/** Every signed-in person's account page, a Funktion or none held: their sign-in is theirs either way. */
export default async function KontoPage() {
  await connection();
  const subject = await getSubjectSession();
  // Nothing rather than a second redirect, for the reason
  // `fl_frontend/src/app/bereich/(persoenlich)/layout.tsx :: PersonChrome` gives.
  if (subject === null) return null;

  return (
    <KontoPanel
      email={subject.email}
      sicherheit={<SicherheitSection />}
    />
  );
}
