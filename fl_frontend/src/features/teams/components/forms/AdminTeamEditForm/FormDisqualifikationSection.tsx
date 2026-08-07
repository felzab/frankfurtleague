"use client";

import { Calendar, DateField, DatePicker, FieldError, Input, Switch, TextField } from "@heroui/react";

import { Callout } from "@/shared/components/ui/Callout";
import { FIELD_ERROR, FIELD_GROUP, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { TeamFieldLabel } from "./TeamFieldLabel";

import type { FLDisqualifikation } from "@/features/teams/schemas";
import type { CalendarDate } from "@internationalized/date";

/**
 * The disqualification, as the editor's danger zone — the match editor's Absage section, applied to
 * the one control on this page that removes a club from play (owner, 2026-08-07: the two Saison
 * concerns split, this one last and in the danger tone).
 *
 * The record travels whole: the payload requires `disqualifikation` with no default, so lifting one
 * sends the explicit `null` and a form that forgot the field would be a 422, never a team quietly
 * reinstated (ADR-0059). The switch only edits the DRAFT — nothing happens until the page's save.
 */
export function FormDisqualifikationSection({
  isDisqualified,
  onIsDisqualifiedChange,
  storedRecord,
  grund,
  onGrundChange,
  datum,
  onDatumChange,
  onValidateFields,
}: {
  isDisqualified: boolean;
  onIsDisqualifiedChange: (next: boolean) => void;
  /** The record as stored, so the callouts can tell entering one apart from lifting one. */
  storedRecord: FLDisqualifikation | null;
  grund: string;
  onGrundChange: (next: string) => void;
  datum: CalendarDate | null;
  onDatumChange: (next: CalendarDate | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  const styles = formPanel({ tone: "danger" });

  // Only for the flip the admin makes in THIS edit — a stored disqualification is the rail's
  // standing note, not an announcement.
  const isBeingEntered = isDisqualified && storedRecord === null;
  const isBeingLifted = !isDisqualified && storedRecord !== null;

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Disqualifikation
          <InfoHint label="Hinweis zur Disqualifikation">
            <p>Der einzige Weg aus einer Saison — eine Mannschaft verlässt sie nie anders.</p>
            <ul>
              <li>
                Der <strong>Grund ist öffentlich</strong> und erscheint wie eingegeben.
              </li>
              <li>
                Die Tabelle <strong>überspringt</strong> die Mannschaft bei der Platzvergabe; ihre Ergebnisse bleiben gewertet.
              </li>
              <li>Aufheben entfernt Grund und Datum ersatzlos — es gibt keinen Verlauf.</li>
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
              <Input
                placeholder="z.B. Rückzug nach dem 3. Spieltag"
                className={FIELD_INPUT}
              />
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
              <DatePicker.Popover className="p-2">
                <Calendar
                  aria-label="Wirksamkeitsdatum auswählen"
                  className={`${overlayPanel()} p-3`}>
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
        {isBeingEntered && (
          <Callout
            severity="danger"
            isAnnounced
            title="Der Grund wird veröffentlicht">
            Er erscheint als eingegebener Text auf der Teamseite und als Hinweis an jedem Spiel der Mannschaft — sobald Du speicherst.
          </Callout>
        )}

        {/* Standing rather than announced: it describes the pending lift, not the flip itself. */}
        {isBeingLifted && (
          <Callout
            severity="warning"
            title="Aufheben entfernt den Eintrag ersatzlos">
            Der gespeicherte Grund und das Datum sind danach nicht wiederherstellbar — es gibt keinen Verlauf, der sie aufbewahrt.
          </Callout>
        )}
      </div>
    </section>
  );
}
