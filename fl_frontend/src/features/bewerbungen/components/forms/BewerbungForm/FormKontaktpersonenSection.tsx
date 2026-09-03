"use client";

import { useId } from "react";

import { parseDate } from "@internationalized/date";

import { Calendar, DateField, DatePicker, FieldError, Input, Label, Switch, TextField } from "@heroui/react";

import { LIGA_EINWILLIGUNG } from "@/core/einwilligung";
import { geburtsdatumSpanne } from "@/features/bewerbungen/utils";
import { KONTAKT_NAME_MAX_LENGTH } from "@/features/teams/constants";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  FIELD_LABEL,
  FIELD_PAIR,
  FORM_SECTION_HEADING,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { BewerbungKontaktpersonDraft } from "@/features/bewerbungen/types";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";

/** The empty string is a date nobody has entered yet, which the picker shows as empty rather than refuses. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/**
 * The claim's own payload path. ONE field behind two switches, so it is spelled once here rather
 * than derived per seat: the two cannot then name it differently.
 */
const ZUGLEICH_PATH = "kontakte.trainer_ist_zugleich";

export type SeatRolle = "ansprechperson" | "stellvertretung" | "trainer";

/**
 * What each seat is for, behind the heading's own glyph.
 *
 * **Spelled out per seat rather than looked up from `BEWERBUNG_SEATS`**: `hintCap.test.ts` counts a
 * body written as a literal, and an interpolated one is a hint nothing measures.
 */
const SEAT_HINT: Record<SeatRolle, ReactNode> = {
  trainer: (
    <Hint
      mode="reveal"
      label="Hinweis zur Trainerin oder zum Trainer"
      body={{ lead: "Wer das Team am Spieltag betreut und aufstellt." }}
    />
  ),
  ansprechperson: (
    <Hint
      mode="reveal"
      label="Hinweis zur Ansprechperson"
      body={{ lead: "Wen die Liga zuerst anruft, wenn es um Dein Team geht." }}
    />
  ),
  stellvertretung: (
    <Hint
      mode="reveal"
      label="Hinweis zur Stellvertretung"
      body={{ lead: "Wen die Liga erreicht, wenn die Ansprechperson gerade nicht kann." }}
    />
  ),
};

/**
 * The three people a school is reached through.
 *
 * **The Trainer is asked for first**, and the claim that fills that seat is made from either of the
 * other two: a seat marked as the coach becomes the source, and the Trainer's own boxes read out.
 */
export function FormKontaktpersonenSection({
  seat,
  label,
  person,
  /** This seat's person is also the coach, which is the claim that fills the Trainer seat from here. */
  istZugleichTrainer,
  isMirrored,
  onChange,
  onZugleichToggled,
  onFieldLeft,
  onPersonPicked,
}: {
  seat: SeatRolle;
  label: string;
  person: BewerbungKontaktpersonDraft;
  istZugleichTrainer?: boolean;
  /** This seat IS another seat's person, so its boxes read out rather than take input. */
  isMirrored: boolean;
  onChange: (next: BewerbungKontaktpersonDraft) => void;
  /**
   * Absent on the Trainer seat, which is the one the claim points AT rather than from. Bound to this
   * seat by the caller, so nothing here has to narrow `seat` back down to the two that can be claimed.
   */
  onZugleichToggled?: (istZugleich: boolean) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Judged with the person the event carried, because state has not committed yet. */
  onPersonPicked: (paths: readonly string[], person: BewerbungKontaktpersonDraft) => void;
}) {
  const panel = formPanel();
  const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr());

  // `aria-readonly` says the fields are frozen; only this says by what, so the mirrored ones point at it.
  const spiegelHinweisId = useId();

  const path = (feld: string) => `kontakte.${seat}.${feld}`;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={label}>
          {SEAT_HINT[seat]}
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {onZugleichToggled !== undefined && (
          /* The Switch holds the name, as the consent one does: its own checkbox then carries the refusal
             the route's parse can put on this path, and a reader hears it. */
          <Switch
            className="flex w-full flex-col gap-y-1"
            name={ZUGLEICH_PATH}
            isSelected={istZugleichTrainer === true}
            onChange={onZugleichToggled}>
            <Switch.Content className={panel.switchContent()}>
              Diese Person ist zugleich Trainerin oder Trainer
              <Switch.Control className={panel.switchControl()}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
            <FieldError className={FIELD_ERROR} />
          </Switch>
        )}

        {isMirrored && (
          <p
            id={spiegelHinweisId}
            className="muted-hint">
            Diese Angaben gehören der Person, die Du als zugleich Trainerin oder Trainer markiert hast. Ändere sie dort.
          </p>
        )}

        <div className={FIELD_PAIR}>
          <TextField
            isReadOnly={isMirrored}
            aria-describedby={isMirrored ? spiegelHinweisId : undefined}
            isRequired
            name={path("vorname")}
            value={person.vorname}
            onChange={(next) => onChange({ ...person, vorname: next })}
            onBlur={() => onFieldLeft([path("vorname")])}
            maxLength={KONTAKT_NAME_MAX_LENGTH}>
            <Label className={FIELD_LABEL}>Vorname</Label>
            <Input className={FIELD_INPUT} />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            isReadOnly={isMirrored}
            aria-describedby={isMirrored ? spiegelHinweisId : undefined}
            isRequired
            name={path("nachname")}
            value={person.nachname}
            onChange={(next) => onChange({ ...person, nachname: next })}
            onBlur={() => onFieldLeft([path("nachname")])}
            maxLength={KONTAKT_NAME_MAX_LENGTH}>
            <Label className={FIELD_LABEL}>Nachname</Label>
            <Input className={FIELD_INPUT} />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>

        <div className={FIELD_PAIR}>
          <TextField
            isReadOnly={isMirrored}
            aria-describedby={isMirrored ? spiegelHinweisId : undefined}
            isRequired
            type="email"
            name={path("email")}
            value={person.email}
            onChange={(next) => onChange({ ...person, email: next })}
            onBlur={() => onFieldLeft([path("email")])}>
            <Label className={FIELD_LABEL}>E-Mail</Label>
            <Input
              placeholder="z.B. name@beispiel.de"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <TextField
            isReadOnly={isMirrored}
            aria-describedby={isMirrored ? spiegelHinweisId : undefined}
            isRequired
            type="tel"
            name={path("telefon")}
            value={person.telefon}
            onChange={(next) => onChange({ ...person, telefon: next })}
            onBlur={() => onFieldLeft([path("telefon")])}>
            <Label className={FIELD_LABEL}>Telefon</Label>
            <Input
              placeholder="z.B. 069 1234567"
              className={FIELD_INPUT}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>
        </div>

        <div className={FIELD_PAIR}>
          <DatePicker
            isReadOnly={isMirrored}
            aria-describedby={isMirrored ? spiegelHinweisId : undefined}
            isRequired
            value={toCalendarDate(person.geburtsdatum)}
            // `""` for a cleared date is what the schema rejects with its own German message, so a
            // half-entered person is a field error rather than a silent skip.
            onChange={(next) => onChange({ ...person, geburtsdatum: next?.toString() ?? "" })}
            onBlur={() => onFieldLeft([path("geburtsdatum")])}
            name={path("geburtsdatum")}
            className="w-full">
            <Label className={FIELD_LABEL}>Geburtsdatum</Label>
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
              {/* The span greys days out where dates are OFFERED, never on the field, which judges: a bound
                  there paints a message on each keystroke of a half-typed year. The schema refuses the same
                  span from the same `geburtsdatumSpanne`. */}
              <Calendar
                aria-label={`${label}: Geburtsdatum auswählen`}
                minValue={parseDate(frueheste)}
                maxValue={parseDate(spaeteste)}
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

        <div className="border-border/60 flex w-full flex-col gap-y-3 border-t pt-4">
          <h3 className={FORM_SECTION_HEADING}>Einwilligung</h3>

          <p className="fluid-xxs text-foreground-muted leading-relaxed font-medium text-pretty">{LIGA_EINWILLIGUNG.text}</p>

          {/* The Switch holds the NAME itself: `SwitchField` takes one, so its own checkbox carries
              `aria-required` and `aria-invalid` and is described by the message below it. */}
          <Switch
            className="flex w-full flex-col gap-y-1"
            name={path("einwilligung.erteilt")}
            isRequired
            isReadOnly={isMirrored}
            aria-describedby={isMirrored ? spiegelHinweisId : undefined}
            isSelected={person.einwilligung.erteilt}
            onChange={(erteilt) => {
              const next = { ...person, einwilligung: { ...person.einwilligung, erteilt } };

              onChange(next);
              // A pick, so it is judged on the press rather than on a blur no switch produces —
              // and on the value the event carried, state not having committed yet.
              onPersonPicked([path("einwilligung.erteilt")], next);
            }}>
            <Switch.Content className={panel.switchContent()}>
              Ja, ich bin einverstanden
              <Switch.Control className={panel.switchControl()}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
            <FieldError className={FIELD_ERROR} />
          </Switch>
        </div>
      </div>
    </section>
  );
}
