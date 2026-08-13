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

/**
 * The one clear affordance for the two segmented fields.
 *
 * It exists because a segmented field has no other way back to empty: react-aria clears one segment
 * per Backspace, so "kein Termin mehr" — a legitimate value, the stored `null` the pickers render as
 * TBD — otherwise costs one press per segment plus the knowledge that it was possible at all.
 * Rendered only while there is something to clear, exactly like the pickers' own clear buttons.
 *
 * **Only the markup and the handlers are local; the treatment is `dismissControl`'s**, which is where
 * every X on the site gets its size, corner, colour and hover fill. A class list written out here is
 * one clear control that answers to nothing when that recipe moves, which is how a hover fill goes
 * missing from exactly one X and nothing reports it.
 *
 * A plain button rather than a react-aria one: it lives inside the group whose focus styling is
 * keyed off `:focus-within` in `globals.css`, and a `Button` would add press/hover state machinery
 * for what is a single synchronous state reset. `data-field-clear` is the hook that stylesheet needs
 * to hand it a focus outline back: the group strips one from every button inside it because its own
 * border already says focus is in the field, and this button is one tab stop among the segments,
 * which a single border cannot tell apart.
 *
 * **Focus must not be on this button when the value is cleared**, because clearing removes it and a
 * browser fires no blur for an element it removes: `useFocusWithin` on the group never learns focus
 * left and `data-focus-within` stays set while `document.activeElement` is `<body>` — a field
 * claiming a focus nobody holds, nothing that can be typed into, and a Tab that resumes from the top
 * of the document rather than from here.
 *
 * The CLICK handler is what holds that, and it holds it on both paths: it moves focus into the group
 * before clearing, the order `FormNotizSection`'s note delete also keeps, so a pointer press and the
 * keyboard's Tab-then-Enter — which fires the same click — both end inside the field.
 *
 * `preventDefault` on `mousedown` is a second guard rather than the pointer path's own, and it earns
 * its place by making the outcome independent of the ref: a press never makes this button the active
 * element at all, so nothing is stranded even in the branch where `groupRef.current` is null and the
 * focus call quietly does nothing. It is also how react-aria treats a search field's own clear
 * control (`useSearchField` focuses the input on press start). The two do not fight — cancelling a
 * `mousedown` default suppresses only the browser's own focus transfer, so the `click` still fires
 * and a scripted `focus()` inside it is untouched.
 *
 * The group is the focus target because react-aria makes only the segments focusable —
 * `useDateSegment` gives each `tabIndex: 0`, `useDateField` leaves the group without one — and
 * HeroUI 3.2.3 exposes a `ref` on `DateField.Group` alone, never on `DateField.Segment` or
 * `DateField.Input`. Hence `tabIndex={-1}` on the group: it stays out of the tab order, focus lands
 * on something real rather than on `<body>`, and the next Tab enters the field at its first segment.
 * The group does not read as an edited field while it holds that focus — `globals.css` returns its
 * border to the resting one and marks the keyboard path with the app's standard outline instead.
 *
 * **The keyboard path is closed by reasoning, not yet by observation.** Tab-then-Enter now runs the
 * same focus-then-clear handler, so it should end inside the field rather than on `<body>`; the
 * event ordering holds in a reduction of this markup, but neither path has been watched in the admin
 * UI in this composed form.
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
      {...dismissControl({
        label,
        // A plain `<button>`, so react-aria writes no `data-hovered` and the centring and the
        // interactive cursor HeroUI's own controls get from their component CSS are this host's.
        hover: "css",
        className: "flex cursor-pointer items-center justify-center",
      })}
      data-field-clear="true"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        groupRef.current?.focus();
        onClear();
      }}>
      <Xmark />
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
