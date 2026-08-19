import { Separator } from "@heroui/react";

import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { FormDateTimeSection } from "./FormDateTimeSection";
import { FormSchiedsrichterSection } from "./FormSchiedsrichterSection";
import { FormSpielortSection } from "./FormSpielortSection";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielOrtFieldDraft, FLSpielSchiedsrichterFieldDraft } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { CalendarDate, Time } from "@internationalized/date";

/**
 * **First on the page**, ordered by the admin's task rather than the data model: the only panel
 * applying to every fixture in every phase, and where most action-required categories land.
 */
export function FormAnsetzungSection({
  datum,
  onDatumChange,
  uhrzeit,
  onUhrzeitChange,
  spielorte,
  ortPayload,
  onOrtChange,
  schiedsrichter,
  schiedsrichterPayload,
  onSchiedsrichterChange,
  onValidateFields,
}: {
  datum: CalendarDate | null;
  onDatumChange: (value: CalendarDate | null) => void;
  uhrzeit: Time | null;
  onUhrzeitChange: (value: Time | null) => void;
  spielorte: FLSpielort[];
  ortPayload: FLSpielOrtFieldDraft | null;
  onOrtChange: (payload: FLSpielOrtFieldDraft | null) => void;
  schiedsrichter: FLSchiedsrichter[];
  schiedsrichterPayload: FLSpielSchiedsrichterFieldDraft | null;
  onSchiedsrichterChange: (payload: FLSpielSchiedsrichterFieldDraft | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel();

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Ansetzung
          <InfoHint label="Hinweis zur Ansetzung">
            <p>Wann, wo und mit wem das Spiel stattfindet.</p>
            <ul>
              <li>
                <strong>Datum</strong> und <strong>Anpfiff</strong> lassen sich über das ×-Symbol wieder auf „offen“ setzen.
              </li>
              <li>
                <strong>Mietpreis</strong> und <strong>Entschädigung</strong> sind vorbelegt und gelten nur für dieses Spiel.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Termin</h3>
          <FormDateTimeSection
            datum={datum}
            onDatumChange={onDatumChange}
            uhrzeit={uhrzeit}
            onUhrzeitChange={onUhrzeitChange}
            onValidateFields={onValidateFields}
          />
        </div>

        <Separator className="bg-border" />

        <FormSpielortSection
          spielorte={spielorte}
          ortPayload={ortPayload}
          onOrtChange={onOrtChange}
          onValidateFields={onValidateFields}
        />

        <Separator className="bg-border" />

        <FormSchiedsrichterSection
          schiedsrichter={schiedsrichter}
          schiedsrichterPayload={schiedsrichterPayload}
          onSchiedsrichterChange={onSchiedsrichterChange}
          onValidateFields={onValidateFields}
        />
      </div>
    </section>
  );
}
