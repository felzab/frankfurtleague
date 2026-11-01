import { redirect } from "next/navigation";

import { rolesOf } from "@/core/roles";
import { FunktionenView } from "@/features/funktionen/components/views/FunktionenView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { zieleOf } from "@/features/funktionen/utils";

/** Where a signed-in person lands, and the switch between everything they hold. */
export default async function PersoenlichStartPage() {
  const subject = await requireSubjectSession();

  // An address holding a grant, past the administrator's window or short of the passkey, owes a fresh
  // sign-in or its passkey step, which `/bereich/admin` sends it on to, not a person's landing.
  if (!subject.admin && subject.subject.verwaltung !== null) redirect("/bereich/admin");

  const { roles: funktionen, unconfirmed: unbestaetigt } = rolesOf(subject);
  const ziele = zieleOf(funktionen);
  const [erstes, ...weitere] = ziele;

  if (erstes === undefined)
    return (
      <FunktionenView
        zustand="konto"
        unbestaetigt={unbestaetigt}
      />
    );

  // Every person lands on a page named „Übersicht“: a team's own
  // landing is one, so one team alone goes straight on; any other lone place is one card here.
  const [{ art }] = erstes.funktionen;
  if (weitere.length === 0 && art === "kontakt") redirect(erstes.href);

  return (
    <FunktionenView
      zustand="auswahl"
      ziele={ziele}
    />
  );
}
