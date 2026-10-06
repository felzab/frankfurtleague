import { Angabe, NICHT_HINTERLEGT } from "@/shared/components/ui/Angabe";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { isPlaceholderAddress } from "@/shared/schemas";
import { formatEuro, formatSpielDatum } from "@/shared/utils/format";

import type { FLSchiedsrichterSelbst } from "../../schemas";

// A row with no address of its own holds the `.invalid` placeholder, which is no address to show.
const adresseVon = (email: string | null): string => (email === null || email === "" || isPlaceholderAddress(email) ? NICHT_HINTERLEGT : email);

/**
 * What the league stores on one referee row, read-only, as the referee's confirmation page lists it:
 * the referee's own page and the account page show the same facts.
 */
export function SchiedsrichterAngaben({ eintrag }: { eintrag: FLSchiedsrichterSelbst }) {
  return (
    <dl className={FIELD_PAIR_CLASSES}>
      <Angabe label="Name">{eintrag.name}</Angabe>
      <Angabe label="Schule">{eintrag.schule ?? NICHT_HINTERLEGT}</Angabe>
      <Angabe label="E-Mail-Adresse">{adresseVon(eintrag.kontakt.email)}</Angabe>
      <Angabe label="Telefon">{eintrag.kontakt.telefon ?? NICHT_HINTERLEGT}</Angabe>
      <Angabe label="Geburtsdatum">{formatSpielDatum(eintrag.geburtsdatum, NICHT_HINTERLEGT)}</Angabe>
      <Angabe label="Honorar">{formatEuro(eintrag.honorar)}</Angabe>
    </dl>
  );
}
