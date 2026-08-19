import { useRef } from "react";

import { Xmark } from "@gravity-ui/icons";

import { Calendar, DateField, DatePicker, FieldError, TimeField } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
} from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { FieldLabel } from "./FieldLabel";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { CalendarDate, Time } from "@internationalized/date";
import type { RefObject } from "react";

/** A segmented field has no other way back to empty, react-aria clearing one segment per Backspace. */
function ClearFieldButton({ label, onClear, groupRef }: { label: string; onClear: () => void; groupRef: RefObject<HTMLDivElement | null> }) {
  return (
    <button
      type="button"
      {...dismissControl({
        label,
        // A plain `<button>`, so react-aria writes no `data-hovered` and the centring and cursor
        // HeroUI's own controls take from component CSS are this host's.
        hover: "css",
        className: "flex cursor-pointer items-center justify-center",
      })}
      data-field-clear="true"
      // Focus must not sit here when the value clears: clearing unmounts this button, no blur fires
      // for a removed element, and the group is left claiming a focus `<body>` holds. Moving focus
      // first on `mousedown` keeps that independent of the ref.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        // The GROUP: HeroUI exposes a `ref` there alone, never on `DateField.Segment` or
        // `.Input`, and passing one to either is a type error rather than a silent miss.
        groupRef.current?.focus();
        onClear();
      }}>
      <Xmark />
    </button>
  );
}

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
  const datumGroupRef = useRef<HTMLDivElement>(null);
  const uhrzeitGroupRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2"
      onKeyDownCapture={suppressEnterSubmit}>
      <DatePicker
        value={datum}
        onChange={onDatumChange}
        onBlur={() => onValidateFields(["datum"])}
        name="datum"
        className="w-full">
        <FieldLabel path="datum">Spieldatum</FieldLabel>
        <DateField.Group
          ref={datumGroupRef}
          tabIndex={-1}
          fullWidth
          className={FIELD_GROUP}>
          {/* HeroUI styles literal segments with `text-muted`, a *background* token, leaving the
              separators at roughly 1.1:1 against the field surface. */}
          <DateField.Input className="fluid-sm">
            {(segment) => (
              <DateField.Segment
                segment={segment}
                className="data-[type=literal]:text-foreground-muted"
              />
            )}
          </DateField.Input>
          <DateField.Suffix>
            {datum !== null && (
              <ClearFieldButton
                label="Datum entfernen"
                groupRef={datumGroupRef}
                onClear={() => onDatumChange(null)}
              />
            )}
            <DatePicker.Trigger>
              <DatePicker.TriggerIndicator />
            </DatePicker.Trigger>
          </DateField.Suffix>
        </DateField.Group>
        <FieldError className={FIELD_ERROR} />
        <DatePicker.Popover
          className={DATE_PICKER_POPOVER}
          placement={DATE_PICKER_PLACEMENT}>
          <Calendar
            aria-label="Spieldatum auswählen"
            className={`${overlayPanel()} ${DATE_PICKER_CALENDAR}`}>
            <Calendar.Header className="bg-transparent">
              <Calendar.YearPickerTrigger>
                <Calendar.YearPickerTriggerHeading />
                <Calendar.YearPickerTriggerIndicator />
              </Calendar.YearPickerTrigger>
              <Calendar.NavButton slot="previous" />
              <Calendar.NavButton slot="next" />
            </Calendar.Header>
            <Calendar.Grid>
              <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
              <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
            </Calendar.Grid>
            <Calendar.YearPickerGrid>
              <Calendar.YearPickerGridBody>{({ year }) => <Calendar.YearPickerCell year={year} />}</Calendar.YearPickerGridBody>
            </Calendar.YearPickerGrid>
          </Calendar>
        </DatePicker.Popover>
      </DatePicker>

      <TimeField
        className="w-full"
        name="uhrzeit"
        hourCycle={24}
        value={uhrzeit}
        onChange={onUhrzeitChange}
        onBlur={() => onValidateFields(["uhrzeit"])}>
        <FieldLabel path="uhrzeit">Anpfiff</FieldLabel>
        <TimeField.Group
          ref={uhrzeitGroupRef}
          tabIndex={-1}
          className={FIELD_GROUP}>
          <TimeField.Input className="fluid-sm w-full">
            {(segment) => (
              <TimeField.Segment
                segment={segment}
                className="data-[type=literal]:text-foreground-muted"
              />
            )}
          </TimeField.Input>
          {uhrzeit !== null && (
            <ClearFieldButton
              label="Uhrzeit entfernen"
              groupRef={uhrzeitGroupRef}
              onClear={() => onUhrzeitChange(null)}
            />
          )}
        </TimeField.Group>
        <FieldError className={FIELD_ERROR} />
      </TimeField>
    </div>
  );
}
