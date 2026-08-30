"use client";

import { Calendar, DateField, DatePicker, FieldError, Input, Switch, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { AUSTRITT_OPTIONS } from "@/features/teams/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  TOGGLE_GROUP_ALIGN,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLAustrittType } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";
import type { CalendarDate } from "@internationalized/date";
import type { TeamBanner } from "./banners";

/** Names the exit-type chips for a screen reader, `ToggleButtonGroup` carrying its own role and no label element. */
const ART_LABEL_ID = "austritt-art";

/**
 * **No hover or press variant**: HeroUI's own fills are `@layer components` and these utilities are
 * declared last, so each state's resting background suppresses them. `StufenPicker`'s chip, widened
 * for word-length labels.
 */
const ART_CHIP =
  "border-border bg-transparent text-foreground-muted " +
  "data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground " +
  "data-[selected=true]:ring-brand-solid-foreground " +
  "fluid-xs h-9 rounded-lg border px-4 font-extrabold tracking-wide transition-colors";

/**
 * `austritt` is required with no default: lifting one sends an explicit `null`, not a quiet
 * reinstatement. The route starts on NEITHER Art — a default Disqualifikation would file
 * withdrawals as sanctions; unpicked is a field error instead.
 */
export function FormAustrittSection({
  hasAustritt,
  onHasAustrittChange,
  banners,
  art,
  onArtChange,
  grund,
  onGrundChange,
  datum,
  onDatumChange,
  onValidateFields,
}: {
  hasAustritt: boolean;
  onHasAustrittChange: (next: boolean) => void;
  banners: readonly TeamBanner[];
  art: FLAustrittType | null;
  onArtChange: (next: FLAustrittType) => void;
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
          Austritt
          <Hint
            mode="reveal"
            label="Hinweis zum Austritt"
            body={{
              lead: "Das Team scheidet aus dieser Saison aus; seine Spiele bleiben bei ihm.",
              points: [{ term: "Die Tabelle", text: "überspringt das Team bei der Platzvergabe, seine Ergebnisse bleiben gewertet." }],
            }}
          />
        </h2>
      </div>

      <div className={styles.body()}>
        <Switch
          isSelected={hasAustritt}
          onChange={onHasAustrittChange}>
          <Switch.Content className={styles.switchContent()}>
            Team ist ausgeschieden
            <Switch.Control className={styles.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {hasAustritt && (
          <>
            <TextField
              name="austritt.type"
              // The proxy is what makes a refusal land: `ToggleButtonGroup` takes no `name`, so it
              // joins no field context and `form.reportValidity()` cannot see the group.
              value={art ?? ""}
              onChange={() => undefined}
              className="flex w-full flex-col gap-y-1">
              {/* A `Label` and not a plain span: it names the enclosing `TextField`, which carries no
                  `aria-label`, so `useLabel` would warn without it. The id sits on the text alone, keeping
                  the changed-field marker out of the group's name. */}
              <FieldLabel path="austritt">
                <span id={ART_LABEL_ID}>Art</span>
              </FieldLabel>
              {/* Named from the heading rather than by a wrapper: react-aria already renders
                  `role="radiogroup"` here, so a second grouping element around it would nest one group in
                  another and leave the chips with two accessible names. */}
              <ToggleButtonGroup
                aria-labelledby={ART_LABEL_ID}
                size="sm"
                isDetached
                selectionMode="single"
                // Empty is reachable only before the first press, which is the state the schema
                // refuses; once a route is chosen the admin swaps it rather than clearing it.
                disallowEmptySelection
                selectedKeys={art === null ? [] : [art]}
                onSelectionChange={(keys: Set<Key>) => {
                  const [picked] = [...keys].map(String);
                  if (picked !== undefined) onArtChange(picked as FLAustrittType);
                }}
                className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
                {AUSTRITT_OPTIONS.map((option) => (
                  <ToggleButton
                    key={option.value}
                    id={option.value}
                    className={ART_CHIP}>
                    {option.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>

              <Input className="hidden" />
              <FieldError className={FIELD_ERROR} />
            </TextField>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <TextField
                isRequired
                name="austritt.grund"
                value={grund}
                onChange={onGrundChange}
                onBlur={() => onValidateFields(["austritt.grund"])}>
                <FieldLabel path="austritt">Grund</FieldLabel>
                <Input className={FIELD_INPUT} />
                <FieldError className={FIELD_ERROR} />
              </TextField>

              {/* ARIA only: react-aria marks no control inside a date picker, so the browser cannot
                  refuse it empty. `missingVerdicts` supplies the German instead, on submit. */}
              <DatePicker
                isRequired
                value={datum}
                onChange={onDatumChange}
                onBlur={() => onValidateFields(["austritt.datum"])}
                name="austritt.datum"
                className="w-full">
                <FieldLabel path="austritt">Wirksam ab</FieldLabel>
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
          </>
        )}

        {/* Announced, because the admin has just flipped it: the public consequence is the one
            nobody should discover after the fact. */}
        <InlineBanners
          banners={banners}
          spot="austritt-eintrag"
          isAnnounced
        />

        {/* Standing rather than announced: it describes the pending lift, not the flip itself. */}
        <InlineBanners
          banners={banners}
          spot="austritt-aufhebung"
        />
      </div>
    </section>
  );
}
