import { redirect } from "next/navigation";
import { connection } from "next/server";

import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { EinwilligungSection } from "@/features/konto/components/views/EinwilligungSection";
import { SicherheitSection } from "@/features/konto/components/views/SicherheitSection";
import { KontoPanel } from "@/shared/components/ui/KontoPanel";

/** Every signed-in person's account page, a Funktion or none held: their sign-in is theirs either way. */
export default async function KontoPage() {
  await connection();
  const subject = await requireSubjectSession();

  // A granted address whose administrator verdict lapsed owes that lane's step before its passkeys,
  // as the landing sends it (`docs/frontend/spec.md :: I426`); here the section stands empty.
  // eslint-disable-next-line local/admin-link -- the proxy turns it away before any season is read
  if (!subject.admin && subject.subjekt.verwaltung !== null) redirect("/bereich/admin");

  return (
    <KontoPanel
      email={subject.email}
      sicherheit={<SicherheitSection />}
      einwilligung={<EinwilligungSection />}
    />
  );
}
