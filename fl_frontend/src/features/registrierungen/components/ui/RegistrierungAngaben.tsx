import { kaderName } from "@/features/spieler/constants";
import { Angabe, NICHT_HINTERLEGT } from "@/shared/components/ui/Angabe";
import { FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSpielerPosition, FLSpielerStufe } from "@/features/spieler/schemas";

/** What one pending registration stores, as its pupil typed it: the registration form's own labels. */
type Angaben = {
  readonly vorname: string;
  readonly nachname: string;
  readonly geburtsdatum: string | null;
  readonly nummer: string | null;
  readonly position: FLSpielerPosition | null;
  readonly stufe: FLSpielerStufe | null;
};

/** What the league stores on a pending registration, read-only, labelled as the registration form asked it. */
export function RegistrierungAngaben({ registrierung }: { registrierung: Angaben }) {
  return (
    <dl className={FIELD_PAIR_CLASSES}>
      <Angabe label="Name">{kaderName(registrierung)}</Angabe>
      <Angabe label="Geburtsdatum">{formatSpielDatum(registrierung.geburtsdatum, NICHT_HINTERLEGT)}</Angabe>
      <Angabe label="Rückennummer">{registrierung.nummer ?? NICHT_HINTERLEGT}</Angabe>
      <Angabe label="Position">{registrierung.position ?? NICHT_HINTERLEGT}</Angabe>
      <Angabe label="Stufe">{registrierung.stufe ?? NICHT_HINTERLEGT}</Angabe>
    </dl>
  );
}
