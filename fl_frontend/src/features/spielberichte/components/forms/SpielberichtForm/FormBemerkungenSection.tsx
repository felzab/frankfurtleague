"use client";

import { FieldError } from "@heroui/react/field-error";
import { TextArea } from "@heroui/react/textarea";

import { useFieldStatus } from "@/shared/components/ui/DraftStatusContext";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR_CLASSES, FIELD_TEXTAREA_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";

import { SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH } from "../../../constants";
import { BEMERKUNGEN_PATH } from "../../../utils";

import type { SpielberichtFieldPath } from "./spielberichtDraft";

/**
 * The one free text of a report, for what no field holds. The backend refuses any name of the match's people in it
 * (`REQ-BERICHT-005`), so the hint asks for a shirt number before a press does.
 */
export function FormBemerkungenSection({
  bemerkungen,
  onChange,
  onValidateFields,
}: {
  bemerkungen: string;
  onChange: (next: string) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();
  const status = useFieldStatus<SpielberichtFieldPath>(BEMERKUNGEN_PATH);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Bemerkungen"
        />
      </div>

      <div className={panel.body()}>
        <TextField
          name={BEMERKUNGEN_PATH}
          value={bemerkungen}
          onChange={onChange}
          onBlur={() => onValidateFields([BEMERKUNGEN_PATH])}
          maxLength={SPIELBERICHT_BEMERKUNGEN_MAX_LENGTH}
          isInvalid={status?.error ? true : undefined}>
          <FieldLabel<SpielberichtFieldPath> path={BEMERKUNGEN_PATH}>Bemerkungen zum Spiel</FieldLabel>
          <TextArea
            fullWidth
            placeholder="z.B. Spiel wegen Gewitter zehn Minuten unterbrochen"
            className={`${FIELD_TEXTAREA_CLASSES} min-h-24`}
          />
          <FieldError className={FIELD_ERROR_CLASSES}>{status?.error}</FieldError>
          {/* Under the box rather than behind a press: the reader it has to reach is the one already typing a name. Both
              writers are told who reads it: the referee booked now reads what an administrator or an earlier referee wrote. */}
          <Hint
            mode="field"
            text={`Lesen können sie nur die Schiedsrichterin oder der Schiedsrichter des Spiels und die Verwaltung der Liga. Schreib hier, was kein Feld oben erfasst, etwa einen Vorfall oder einen Protest. Den Grund einer Karte wählst Du bei der Karte. Nenne keine Namen, auch keinen Spielernamen: Eine Spielerin oder einen Spieler beschreibst Du mit der Rückennummer.`}
          />
        </TextField>
      </div>
    </section>
  );
}
