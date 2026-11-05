import { redirect } from "next/navigation";

import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { FunktionenView } from "@/features/funktionen/components/views/FunktionenView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { soleTeamOf, zieleOf } from "@/features/funktionen/utils";

/** Where a signed-in person lands, and the switch between everything they hold. */
export default async function PersoenlichStartPage() {
  const subject = await requireSubjectSession();

  // An address holding a grant, past the administrator's window or short of the passkey, owes a fresh
  // sign-in or its passkey step, which the sign-in's landing sends it on to, not a person's landing.
  if (!subject.admin && subject.subject.verwaltung !== null) redirect(ROUTES.signInLanding.path());

  const { roles: roles, unconfirmed: unbestaetigt } = rolesOf(subject);
  const ziele = zieleOf(roles);

  if (ziele.length === 0)
    return (
      <FunktionenView
        zustand="konto"
        unbestaetigt={unbestaetigt}
      />
    );

  // Every person lands on a page named „Übersicht“, a team's own landing among them.
  const team = soleTeamOf(ziele);
  if (team !== null) redirect(team);

  return (
    <FunktionenView
      zustand="auswahl"
      ziele={ziele}
    />
  );
}
