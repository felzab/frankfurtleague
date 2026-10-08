import { redirect } from "next/navigation";
import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { FunktionenView } from "@/features/funktionen/components/views/FunktionenView";
import { requireSubjectSession } from "@/features/funktionen/resolvers";
import { zieleOf } from "@/features/funktionen/utils";

/** Where a signed-in person lands, and the switch between everything they hold. */
export default async function PersoenlichStartPage() {
  await connection();
  const subject = await requireSubjectSession();

  // An address holding a grant, past the administrator's window or short of the passkey, owes the
  // admin subtree's step, not a person's landing (`docs/frontend/spec.md :: I386`).
  // eslint-disable-next-line local/admin-link -- the proxy turns it away before any season is read
  if (!subject.admin && subject.subjekt.verwaltung !== null) redirect("/bereich/admin");

  const { funktionen, unbestaetigt } = funktionenOf(subject);
  const ziele = zieleOf(funktionen);
  const [erstes, ...weitere] = ziele;

  if (erstes === undefined)
    return (
      <FunktionenView
        zustand="konto"
        unbestaetigt={unbestaetigt}
      />
    );

  // Every person lands on a page named „Übersicht“ (`docs/frontend/spec.md :: I466`): a team's own
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
