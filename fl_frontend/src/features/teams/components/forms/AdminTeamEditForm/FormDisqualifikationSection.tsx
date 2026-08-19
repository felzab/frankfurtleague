"use client";

import { Calendar, DateField, DatePicker, FieldError, Input, Switch, TextField } from "@heroui/react";

import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { CalendarDate } from "@internationalized/date";
import type { TeamBanner } from "./banners";

/**
 * The disqualification, as the editor's danger zone — the match editor's Absage section, applied to
 * the one control on this page that removes a club from play (decided 2026-08-07: the two Saison
 * concerns split, this one last and in the danger tone).
 *
 * The record travels whole: the payload requires `disqualifikation` with no default, so lifting one
 * sends the explicit `null` and a form that forgot the field would be a 422, never a team quietly
 * reinstated. The switch only edits the DRAFT — nothing happens until the page's save.
 */
export function FormDisqualifikationSection({
  isDisqualified,
  onIsDisqualifiedChange,
  banners,
  grund,
  onGrundChange,
  datum,
  onDatumChange,
  onValidateFields,
}: {
  isDisqualified: boolean;
  onIsDisqualifiedChange: (next: boolean) => void;
  /** The editor's whole Hinweis list; the two spots below take their own entries out of it. */
  banners: readonly TeamBanner[];
  grund: string;
  onGrundChange: (next: string) => void;
  datum: CalendarDate | null;
  onDatumChange: (next: CalendarDate | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel({ tone: "danger" });

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Disqualifikation
          <InfoHint label="Hinweis zur Disqualifikation">
            <p>Der einzige Weg aus einer Saison.</p>
            <ul>
              <li>
                Der <strong>Grund ist öffentlich</strong> und erscheint wie eingegeben.
              </li>
              <li>
                Die Tabelle <strong>überspringt</strong> die Mannschaft bei der Platzvergabe. Ihre Ergebnisse bleiben gewertet.
              </li>
              <li>Aufheben entfernt Grund und Datum ersatzlos. Es gibt keinen Verlauf.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        <Switch
          size="md"
          isSelected={isDisqualified}
          onChange={onIsDisqualifiedChange}>
          <Switch.Content className="fluid-sm text-danger flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
            Mannschaft disqualifizieren
            <Switch.Control className={isDisqualified ? "bg-danger" : ""}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {isDisqualified && (
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TextField
              isRequired
              name="disqualifikation.grund"
              value={grund}
              onChange={onGrundChange}
              onBlur={() => onValidateFields(["disqualifikation.grund"])}>
              <TeamFieldLabel path="disqualifikation">Grund</TeamFieldLabel>
              <Input className={FIELD_INPUT} />
              <FieldError className={FIELD_ERROR} />
            </TextField>

            <DatePicker
              value={datum}
              onChange={onDatumChange}
              onBlur={() => onValidateFields(["disqualifikation.datum"])}
              name="disqualifikation.datum"
              className="w-full">
              <TeamFieldLabel path="disqualifikation">Wirksam ab</TeamFieldLabel>
              <DateField.Group
                fullWidth
                className={FIELD_GROUP}>
                <DateField.Input className="fluid-sm">
                  {(segment) => (
                    <DateField.Segment
                      segment={segment}
                      className="data-[type=literal]:text-foreground-muted"
                    />
                  )}
                </DateField.Input>
                <DateField.Suffix>
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
                  aria-label="Wirksamkeitsdatum auswählen"
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
          </div>
        )}

        {/* Announced, because the admin has just flipped it: the public consequence is the one
            nobody should discover after the fact. */}
        <InlineBanners
          banners={banners}
          spot="dq-eintrag"
          isAnnounced
        />

        {/* Standing rather than announced: it describes the pending lift, not the flip itself. */}
        <InlineBanners
          banners={banners}
          spot="dq-aufhebung"
        />
      </div>
    </section>
  );
}
