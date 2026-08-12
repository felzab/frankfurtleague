import { useRef } from "react";

import { Xmark } from "@gravity-ui/icons";

import { Calendar, DateField, DatePicker, FieldError, TimeField } from "@heroui/react";

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

/**
 * The one clear affordance for the two segmented fields.
 *
 * It exists because a segmented field has no other way back to empty: react-aria clears one segment
 * per Backspace, so "kein Termin mehr" — a legitimate value, the stored `null` the pickers render as
 * TBD — otherwise costs one press per segment plus the knowledge that it was possible at all.
 * Rendered only while there is something to clear, exactly like the pickers' own clear buttons.
 *
 * A plain button rather than a react-aria one: it lives inside the group whose focus styling is
 * keyed off `:focus-within` in `globals.css`, and a `Button` would add press/hover state machinery
 * for what is a single synchronous state reset.
 *
 * **Focus moves to the field group before the value is cleared**, the same order
 * `FormNotizSection`'s note delete keeps. This button unmounts on that state change, and focus left
 * on a removed element falls to `<body>`, so the next Tab restarts at the top of the page. The group
 * is the target because react-aria makes only the segments focusable — `useDateSegment` gives each
 * `tabIndex: 0` and `useDateField` leaves the group without one — so the group carries
 * `tabIndex={-1}`: it stays out of the tab order, `:focus-within` still paints the field's brand
 * border so the move is visible, and the next Tab enters the field at its first segment.
 */
function ClearFieldButton({
  label,
  onClear,
  groupRef,
}: {
  label: string;
  onClear: () => void;
  /** The field group this button sits in, which is why that group carries `tabIndex={-1}`. */
  groupRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        groupRef.current?.focus();
        onClear();
      }}
      className="text-foreground-muted hover:text-foreground flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors">
      <Xmark className="size-4" />
    </button>
  );
}

/**
 * Date and time of the fixture.
 *
 * **Controlled, like every sibling section.** The two fields hold calendar objects and the form converts
 * them at the payload boundary. They are controlled for two reasons that both arrived with the page: the
 * draft payload has to be complete for a field to be judged when it is left (ADR-0040), and a React 19
 * form `action` resets uncontrolled inputs when it resolves — which on a page the admin stays on would
 * blank exactly these two fields.
 *
 * **Both validate on blur, never on change.** A segmented date field reports a value only once every
 * segment is filled, so judging it per keystroke says "Bitte gib ein gültiges Datum ein" to somebody who
 * has typed the day and not yet the month.
 *
 * **Neither field carries a `Description`.** "Wähle das Datum aus, an dem das Spiel stattfindet" under a
 * label reading "Spieldatum" is the label again in more words (ADR-0040).
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
          {/* HeroUI styles literal segments (the "." and ":") with `text-muted`, which is a
              *background* token -- about 1.1:1 against the field surface, so the separators were
              effectively invisible. `data-type` comes from react-aria on every segment. */}
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
