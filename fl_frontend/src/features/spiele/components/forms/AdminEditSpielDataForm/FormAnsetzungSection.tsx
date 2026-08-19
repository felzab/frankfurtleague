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
 * When, where and with whom — the three groups that have to be settled before kick-off.
 *
 * **First on the page, and that order is by the admin's task rather than by the data model.** Four of
 * the eight action-required categories live in this one panel (`datum_missing`, `uhrzeit_missing`,
 * `ort_missing`, `schiedsrichter_missing`), it is the only panel that applies to every fixture in every
 * phase, and it is what most admins arrive to fill in.
 *
 * **One panel, three groups, one `h3`.** They are separate questions with the same answer shape, so a
 * panel each would be three titled boxes saying almost the same thing; a rule between them is enough.
 * Only "Termin" carries a `FORM_SECTION_HEADING`, because its field labels ("Spieldatum", "Anpfiff")
 * do not name the group — the venue and referee groups open with a field label that already does, and
 * a heading there would be the same word twice, one level apart.
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
      {/* No standing hint sentence: what it said lives in the InfoHint, on every panel alike — the
          title carries the surface and the explanation appears when asked for. */}
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

        {/* No sub-group heading on these two: each group's first field label already names it —
            "Spielort" over "Spielort" was the duplicated level reported in review, and
            `FORM_SECTION_HEADING`'s own rule forbids it. The separators still delimit the groups. */}
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
