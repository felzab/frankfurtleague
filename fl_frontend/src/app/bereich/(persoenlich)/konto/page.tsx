import { redirect } from "next/navigation";
import { connection } from "next/server";

import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { AdresswechselSection } from "@/features/konto/components/views/AdresswechselSection";
import { EinwilligungSection } from "@/features/konto/components/views/EinwilligungSection";
import { KontoLoeschenSection } from "@/features/konto/components/views/KontoLoeschenSection";
import { SicherheitSection } from "@/features/konto/components/views/SicherheitSection";
import { KontoPanel } from "@/shared/components/ui/KontoPanel";

/** Every signed-in person's account page, a Funktion or none held: their sign-in is theirs either way. */
export default async function KontoPage() {
  await connection();
  const subject = await requireSubjectSession();

  // A granted address whose administrator verdict lapsed owes a fresh sign-in or its passkey step
  // before its passkeys, as the landing sends it; here the section
  // stands empty.
  if (!subject.admin && subject.subjekt.verwaltung !== null) redirect("/bereich/admin");

  return (
    <KontoPanel
      email={subject.email}
      adresswechsel={<AdresswechselSection />}
      sicherheit={<SicherheitSection />}
      einwilligung={<EinwilligungSection />}
      loeschung={<KontoLoeschenSection />}
    />
  );
}
