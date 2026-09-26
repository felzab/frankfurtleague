import { connection } from "next/server";

import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { SicherheitSection } from "@/features/konto/components/views/SicherheitSection";
import { KontoPanel } from "@/shared/components/ui/KontoPanel";

/** Every signed-in person's account page, a Funktion or none held: their sign-in is theirs either way. */
export default async function KontoPage() {
  await connection();
  const subject = await requireSubjectSession();

  return (
    <KontoPanel
      email={subject.email}
      sicherheit={<SicherheitSection />}
    />
  );
}
