import { Angabe, Leer } from "@/shared/components/ui/Angabe";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formatEuro, formatSpielDatum } from "@/shared/utils/format";

import type { FLSchiedsrichterSelf } from "@/core/generated/client/types";
import type { ReactNode } from "react";

const adresseVon = (email: string | null): ReactNode => (email === null || email === "" ? <Leer /> : email);

/**
 * What the league stores on one referee row, read-only, as the referee's confirmation page lists it:
 * the referee's own page and the account page show the same facts.
 */
export function SchiedsrichterAngaben({ eintrag }: { eintrag: FLSchiedsrichterSelf }) {
  return (
    <dl className={FIELD_PAIR_CLASSES}>
      <Angabe label="Name">{eintrag.name}</Angabe>
      <Angabe label="Schule">{eintrag.schule ?? <Leer />}</Angabe>
      <Angabe label="E-Mail-Adresse">{adresseVon(eintrag.kontakt.email)}</Angabe>
      <Angabe label="Telefon">{eintrag.kontakt.phone ?? <Leer />}</Angabe>
      <Angabe label="Geburtsdatum">{eintrag.birth_date ? formatSpielDatum(eintrag.birth_date) : <Leer />}</Angabe>
      <Angabe label="Honorar">{formatEuro(eintrag.default_payment)}</Angabe>
    </dl>
  );
}
