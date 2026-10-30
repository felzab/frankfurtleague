import { Separator } from "@heroui/react/separator";

import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import { FormDateTimeSection } from "./FormDateTimeSection";
import { FormSchiedsrichterSection } from "./FormSchiedsrichterSection";
import { FormSpielortSection } from "./FormSpielortSection";

import type { FLSchiedsrichter, FLSpielort } from "@/core/generated/client/types";
import type { FLSchiedsrichterAngezeigt } from "@/features/schiedsrichter/types";
import type { FLSpielOrtFieldDraft, FLSpielSchiedsrichterFieldDraft } from "@/features/spiele/schemas";
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
  createdSpielorte,
  ortPayload,
  onOrtChange,
  onRequestSpielort,
  schiedsrichter,
  createdSchiedsrichter,
  schiedsrichterPayload,
  onSchiedsrichterChange,
  onRequestSchiedsrichter,
  onValidateFields,
}: {
  datum: CalendarDate | null;
  onDatumChange: (value: CalendarDate | null) => void;
  uhrzeit: Time | null;
  onUhrzeitChange: (value: Time | null) => void;
  spielorte: FLSpielort[];
  createdSpielorte: FLSpielort[];
  ortPayload: FLSpielOrtFieldDraft | null;
  onOrtChange: (payload: FLSpielOrtFieldDraft | null) => void;
  onRequestSpielort: () => void;
  schiedsrichter: FLSchiedsrichter[];
  createdSchiedsrichter: FLSchiedsrichterAngezeigt[];
  schiedsrichterPayload: FLSpielSchiedsrichterFieldDraft | null;
  onSchiedsrichterChange: (payload: FLSpielSchiedsrichterFieldDraft | null) => void;
  onRequestSchiedsrichter: () => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel();

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <PanelHeading
          className={styles.heading()}
          title="Ansetzung">
          <Hint
            mode="reveal"
            label="Hinweis zur Ansetzung"
            body={{
              lead: "Wann, wo und mit wem das Spiel stattfindet.",
              points: [{ term: "Mietpreis und Honorar", text: "gelten nur für dieses Spiel." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={styles.body()}>
        <div className="flex w-full flex-col gap-y-3">
          <h3 className={FORM_SECTION_HEADING_CLASSES}>Termin</h3>
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
          created={createdSpielorte}
          ortPayload={ortPayload}
          onOrtChange={onOrtChange}
          onRequestCreate={onRequestSpielort}
          onValidateFields={onValidateFields}
        />

        <Separator className="bg-border" />

        <FormSchiedsrichterSection
          schiedsrichter={schiedsrichter}
          created={createdSchiedsrichter}
          schiedsrichterPayload={schiedsrichterPayload}
          onSchiedsrichterChange={onSchiedsrichterChange}
          onRequestCreate={onRequestSchiedsrichter}
          onValidateFields={onValidateFields}
        />
      </div>
    </section>
  );
}
