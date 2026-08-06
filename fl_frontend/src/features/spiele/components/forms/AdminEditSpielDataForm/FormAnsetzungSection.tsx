import { Separator } from "@heroui/react";

import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";

import { FormDateTimeSection } from "./FormDateTimeSection";
import { FormSchiedsrichterSection } from "./FormSchiedsrichterSection";
import { FormSpielortSection } from "./FormSpielortSection";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielOrtFieldDraft, FLSpielSchiedsrichterFieldDraft } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { CalendarDate, Time } from "@internationalized/date";

/**
 * When, where and with whom — the three groups that have to be settled before kick-off.
 *
 * **First on the page, and that order is by the admin's task rather than by the data model.** Four of
 * the eight action-required categories live in this one panel (`datum_missing`, `uhrzeit_missing`,
 * `ort_missing`, `schiedsrichter_missing`), it is the only panel that applies to every fixture in every
 * phase, and it is what most admins arrive to fill in.
 *
 * **One panel, three `h3` sub-groups.** They are separate questions with the same answer shape, so a
 * panel each would be three titled boxes saying almost the same thing; a rule between them is enough.
 * This is also where `FORM_SECTION_HEADING` belongs now — an uppercase micro-label marking a group
 * *inside* a titled panel, rather than being the largest thing on the panel.
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
        <h2 className={styles.heading()}>Ansetzung</h2>
        <p className={styles.hint()}>Wann, wo und mit wem — die Angaben, die vor dem Anpfiff feststehen müssen.</p>
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

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Spielort</h3>
          <FormSpielortSection
            spielorte={spielorte}
            ortPayload={ortPayload}
            onOrtChange={onOrtChange}
            onValidateFields={onValidateFields}
          />
        </div>

        <Separator className="bg-border" />

        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING}>Schiedsrichter</h3>
          <FormSchiedsrichterSection
            schiedsrichter={schiedsrichter}
            schiedsrichterPayload={schiedsrichterPayload}
            onSchiedsrichterChange={onSchiedsrichterChange}
            onValidateFields={onValidateFields}
          />
        </div>
      </div>
    </section>
  );
}
