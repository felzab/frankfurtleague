import { AppDatePicker, AppTimeField } from "@/shared/components/ui/DateTimeFields";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";

import { ExpectedMarker } from "./ExpectedMarker";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { CalendarDate, Time } from "@internationalized/date";

/**
 * **Both validate on blur, never on change.** A segmented field reports a value only once every
 * segment is filled, so per keystroke it demands a valid date from somebody who has typed the day
 * and not yet the month.
 */
export function FormDateTimeSection({
  datum,
  onDatumChange,
  uhrzeit,
  onUhrzeitChange,
  onValidateFields,
}: {
  datum: CalendarDate | null;
  onDatumChange: (value: CalendarDate | null) => void;
  uhrzeit: Time | null;
  onUhrzeitChange: (value: Time | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  return (
    <div
      className={FIELD_PAIR}
      onKeyDownCapture={suppressEnterSubmit}>
      <AppDatePicker
        name="datum"
        label={
          <FieldLabel
            path="datum"
            extraMarker={<ExpectedMarker path="datum" />}>
            Spieldatum
          </FieldLabel>
        }
        calendarLabel="Spieldatum auswählen"
        value={datum}
        onChange={onDatumChange}
        onBlur={() => onValidateFields(["datum"])}
        clearLabel="Datum entfernen"
      />

      <AppTimeField
        name="uhrzeit"
        label={
          <FieldLabel
            path="uhrzeit"
            extraMarker={<ExpectedMarker path="uhrzeit" />}>
            Anpfiff
          </FieldLabel>
        }
        value={uhrzeit}
        onChange={onUhrzeitChange}
        onBlur={() => onValidateFields(["uhrzeit"])}
        clearLabel="Uhrzeit entfernen"
      />
    </div>
  );
}
