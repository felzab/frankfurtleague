"use client";

import { useRef } from "react";
import Link from "next/link";

import { parseDate } from "@internationalized/date";

import { Calendar, DateField, DatePicker, FieldError, Input, Switch, TextField } from "@heroui/react";

import { ALL_SEAT_PATHS } from "@/features/kontakte/kontakteDraftStatus";
import { applySeatPresence, applySharedSeat, mirroredJudgedPaths } from "@/features/kontakte/utils";
import { TrainerZugleichPicker } from "@/features/teams/components/forms/TrainerZugleichPicker";
import { einwilligungHerkunftLabel, KONTAKT_NAME_MAX_LENGTH, KONTAKT_ROLLEN, TRAINER_ZUGLEICH_FRAGE } from "@/features/teams/constants";
import { buildEmptyKontakte } from "@/features/teams/utils";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  FIELD_PAIR,
  FORM_SECTION_HEADING,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum } from "@/shared/utils/format";

import { FormKontaktErasure } from "./FormKontaktErasure";

import type { KontaktRolle } from "@/features/teams/constants";
import type { FLTrainerZugleich } from "@/features/teams/schemas";
import type { KontaktpersonDraft, SaisonTeamKontakteDraft } from "@/features/teams/types";
import type { CalendarDate } from "@internationalized/date";
import type { ReactNode } from "react";
import type { KontakteBanner } from "./banners";

/**
 * What the two read-only consent facts say where the record holds neither yet. Spelled here rather
 * than left blank: an empty box on a read-only field reads as a value that failed to load.
 */
const NOCH_OFFEN = "Noch offen";
const NOCH_NICHT_BESTAETIGT = "Noch nicht bestätigt";

/** The empty string is a date nobody has entered yet, which the picker has to show as empty rather than refuse. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/**
 * The three seats a season holds for one club, each with the agreement its details are kept under.
 * A seat switched on demands a whole person; a seat switched off holds nobody, the state the payload
 * accepts and an erasure leaves.
 */
export function FormKontakteSection({
  value,
  isMember,
  teamHref,
  banners,
  onChange,
  onFieldLeft,
  isDirty,
  onValidateSelection,
}: {
  value: SaisonTeamKontakteDraft | null;
  /** The club holds a junction row for this season. Without one there is nothing here to write to. */
  isMember: boolean;
  /** The club's own page, where the season membership these seats hang off is entered. */
  teamHref: string;
  banners: readonly KontakteBanner[];
  onChange: (next: SaisonTeamKontakteDraft | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Unsaved work in the draft, which both destructive controls here refuse to write over. */
  isDirty: boolean;
  /** Judged with the value that arrived in the event, because state has not committed yet. */
  onValidateSelection: (paths: readonly string[], selected: { kontakte: SaisonTeamKontakteDraft | null }) => void;
}) {
  /**
   * Re-judged wherever a switch RESOLVES what a seat holds. All three path sets, because the composed
   * Trainer reads whichever seat the claim names.
   */
  const revalidateSeats = (next: SaisonTeamKontakteDraft | null) => onValidateSelection(ALL_SEAT_PATHS, { kontakte: next });

  const abgelegt = useRef<Partial<Record<KontaktRolle, KontaktpersonDraft>>>({});

  /* A block to work against whether one is stored yet or not: entering somebody is what creates
     it, and only the editor's deletion section takes it away again. */
  const basis = value ?? buildEmptyKontakte();

  /** The seat the TRAINER tracks: it is the source, and the Trainer's boxes read whatever it holds. */
  const mirroredSeat = basis.trainer_ist_zugleich;

  const judgeFieldsLeft = (paths: readonly string[]) => onFieldLeft(mirroredJudgedPaths(paths, mirroredSeat));

  const applyPerson = (rolle: KontaktRolle, person: KontaktpersonDraft) => {
    onChange({ ...basis, [rolle]: person });
  };

  /** Whether the seat holds anybody. A pick, so it is judged on the press rather than on a blur. */
  const setPresence = (rolle: KontaktRolle, present: boolean) => {
    // Kept out of the draft, which spells an empty seat as `null` and so has nowhere to hold this:
    // switching a seat off and on again returns the person rather than three empty boxes.
    const seat = basis[rolle];
    if (!present && seat !== null) abgelegt.current[rolle] = seat;

    const { next, revalidate } = applySeatPresence(basis, rolle, present, present ? abgelegt.current[rolle] : undefined);

    onChange(next);
    if (revalidate) revalidateSeats(next);
  };

  /**
   * The TRAINER reads out, never the seat the claim names: the named seat is where the person is
   * entered, and `fl_frontend/src/features/kontakte/utils.ts :: mirrorKontakte` composes the Trainer
   * from it at save time.
   */
  const isMirrored = (rolle: KontaktRolle) => rolle === "trainer" && mirroredSeat !== null;

  /** A pick, so it is judged on the press. One closed set, so no press can claim two seats at once. */
  const pickSharedSeat = (seat: FLTrainerZugleich | null) => {
    const { next, revalidate } = applySharedSeat(basis, seat);

    onChange(next);
    if (revalidate) revalidateSeats(next);
  };

  return (
    <>
      {/* No panel of its own: with each seat in a card, a block heading above them carried a title and
          nothing else. What is block-level rides here without a frame around it. */}
      <InlineBanners
        banners={banners}
        spot="kontakte-block"
      />

      {!isMember && (
        // A link and no control: the seats hang off a season membership, and entering one is the club
        // page's write rather than this page's.
        <Link
          href={teamHref}
          className={`${textLink()} fluid-sm w-fit font-bold`}>
          Zur Seite des Teams
        </Link>
      )}

      {/* A PANEL per person, never a rule inside one: drawn the same way, the division between two
        people and the one inside a person read alike, so neither read as a boundary. The public
        form seats its three the same way. */}
      {isMember &&
        KONTAKT_ROLLEN.map(({ value: rolle, label }) => (
          <KontaktpersonFields
            key={rolle}
            rolle={rolle}
            label={label}
            person={basis[rolle]}
            isMirrored={isMirrored(rolle)}
            /* The question belongs to the Trainer seat: it asks who the Trainer IS, and the answer is
             what that seat's boxes then read. */
            zugleich={
              rolle === "trainer" ? (
                <TrainerZugleichPicker
                  value={basis.trainer_ist_zugleich}
                  onPick={pickSharedSeat}
                  labelSlot={<FieldLabel path="kontakte.trainer_ist_zugleich">{TRAINER_ZUGLEICH_FRAGE}</FieldLabel>}
                />
              ) : null
            }
            isDirty={isDirty}
            onPresenceChange={(present) => setPresence(rolle, present)}
            onChange={(person) => applyPerson(rolle, person)}
            onFieldLeft={judgeFieldsLeft}
          />
        ))}
    </>
  );
}

/**
 * What each seat is for, on the seat's own heading.
 *
 * Three different sentences because the three answer different questions. What they SHARE — that none
 * of this is published — is true of the whole slice and is stated on the sidemenu's own hint.
 */
const SEAT_HINT: Record<KontaktRolle, ReactNode> = {
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
      body={{ lead: "Wen die Liga zuerst anruft, wenn es um dieses Team geht." }}
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
 * One seat: its own switch, and beneath it the person and the agreement, or nothing. Empty renders as
 * the switch alone — the record says a seat holds nobody, never why, so no wording here may either.
 */
function KontaktpersonFields({
  rolle,
  label,
  person,
  isMirrored,
  zugleich,
  isDirty,
  onPresenceChange,
  onChange,
  onFieldLeft,
}: {
  rolle: KontaktRolle;
  label: string;
  /** Null where the seat holds nobody, which is a saveable state rather than a half-finished one. */
  person: KontaktpersonDraft | null;
  /** This seat IS another seat's person, so its boxes read out rather than take input. */
  isMirrored: boolean;
  /** The claim's picker, on the Trainer seat alone. `null` on the two seats the claim can name. */
  zugleich: ReactNode;
  isDirty: boolean;
  onPresenceChange: (present: boolean) => void;
  onChange: (next: KontaktpersonDraft) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={label}>
          {SEAT_HINT[rolle]}
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {zugleich}

        {/* The block's own control one seat down, and the same control on purpose: what it answers here
          is the same question, so a second shape for it would read as a different one. */}
        <Switch
          isSelected={person !== null}
          isDisabled={isMirrored}
          onChange={onPresenceChange}>
          <Switch.Content className={panel.switchContent()}>
            {`${label} hinterlegt`}
            <Switch.Control className={panel.switchControl()}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {person !== null && (
          <KontaktpersonInputs
            rolle={rolle}
            label={label}
            person={person}
            isMirrored={isMirrored}
            onChange={onChange}
            onFieldLeft={onFieldLeft}
          />
        )}

        {/* On the seat that HOLDS the person, never the mirrored copy: the claim points two seats at
            one record, and offering the erasure twice would read as two people. */}
        {person !== null && !isMirrored && person.email !== "" && (
          <FormKontaktErasure
            email={person.email}
            fullName={`${person.vorname} ${person.nachname}`.trim() || person.email}
            isDirty={isDirty}
          />
        )}
      </div>
    </section>
  );
}

/** The seat's boxes, mounted only while somebody is recorded in it: every one of them is required. */
function KontaktpersonInputs({
  rolle,
  label,
  person,
  isMirrored,
  onChange,
  onFieldLeft,
}: {
  rolle: KontaktRolle;
  label: string;
  person: KontaktpersonDraft;
  isMirrored: boolean;
  onChange: (next: KontaktpersonDraft) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  const setEinwilligung = (patch: Partial<KontaktpersonDraft["einwilligung"]>) => {
    onChange({ ...person, einwilligung: { ...person.einwilligung, ...patch } });
  };

  return (
    <>
      <div className={FIELD_PAIR}>
        <TextField
          isReadOnly={isMirrored}
          isRequired
          name={`kontakte.${rolle}.vorname`}
          value={person.vorname}
          onChange={(next) => onChange({ ...person, vorname: next })}
          onBlur={() => onFieldLeft([`kontakte.${rolle}.vorname`])}
          maxLength={KONTAKT_NAME_MAX_LENGTH}>
          <FieldLabel path={`kontakte.${rolle}`}>Vorname</FieldLabel>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <TextField
          isReadOnly={isMirrored}
          isRequired
          name={`kontakte.${rolle}.nachname`}
          value={person.nachname}
          onChange={(next) => onChange({ ...person, nachname: next })}
          onBlur={() => onFieldLeft([`kontakte.${rolle}.nachname`])}
          maxLength={KONTAKT_NAME_MAX_LENGTH}>
          <FieldLabel path={`kontakte.${rolle}`}>Nachname</FieldLabel>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR} />
        </TextField>
      </div>

      <div className={FIELD_PAIR}>
        <TextField
          isReadOnly={isMirrored}
          isRequired
          type="email"
          name={`kontakte.${rolle}.email`}
          value={person.email}
          onChange={(next) => onChange({ ...person, email: next })}
          onBlur={() => onFieldLeft([`kontakte.${rolle}.email`])}>
          <FieldLabel path={`kontakte.${rolle}`}>E-Mail</FieldLabel>
          <Input
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <TextField
          isReadOnly={isMirrored}
          isRequired
          type="tel"
          name={`kontakte.${rolle}.telefon`}
          value={person.telefon}
          onChange={(next) => onChange({ ...person, telefon: next })}
          onBlur={() => onFieldLeft([`kontakte.${rolle}.telefon`])}>
          <FieldLabel path={`kontakte.${rolle}`}>Telefon</FieldLabel>
          <Input
            placeholder="z.B. 069 1234567"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>
      </div>

      <div className={FIELD_PAIR}>
        <KontaktDatePicker
          name={`kontakte.${rolle}.geburtsdatum`}
          path={`kontakte.${rolle}`}
          isReadOnly={isMirrored}
          label="Geburtsdatum"
          calendarLabel={`${label}: Geburtsdatum auswählen`}
          value={person.geburtsdatum ?? ""}
          onChange={(next) => onChange({ ...person, geburtsdatum: next })}
          onFieldLeft={onFieldLeft}
        />
      </div>

      <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
        <h4 className={FORM_SECTION_HEADING}>Einwilligung</h4>

        <div className={FIELD_PAIR}>
          {/* Read out and never picked: an administrator may not record a consent as the person's own,
              and the server preserves whatever a confirmation wrote here. */}
          <TextField
            isReadOnly
            value={person.einwilligung.erteilt_von === null ? NOCH_OFFEN : einwilligungHerkunftLabel(person.einwilligung.erteilt_von)}
            onChange={() => undefined}>
            <FieldLabel path={`kontakte.${rolle}.einwilligung`}>Erteilt</FieldLabel>
            <Input className={FIELD_INPUT} />
          </TextField>

          <TextField
            isReadOnly
            value={formatSpielDatum(person.einwilligung.bestaetigt_am, NOCH_NICHT_BESTAETIGT)}
            onChange={() => undefined}>
            <FieldLabel path={`kontakte.${rolle}.einwilligung`}>Bestätigt am</FieldLabel>
            <Input className={FIELD_INPUT} />
          </TextField>
        </div>

        <div className={FIELD_PAIR}>
          <TextField
            isReadOnly
            isRequired
            name={`kontakte.${rolle}.einwilligung.text_version`}
            value={person.einwilligung.text_version}
            onChange={() => undefined}>
            <FieldLabel path={`kontakte.${rolle}.einwilligung`}>Unterschriebene Fassung</FieldLabel>
            {/* Read-only in BOTH directions: a new consent is stamped with the current wording's version,
                and a stored one keeps the version it was given, or the record would claim agreement to a
                text this person never saw. */}
            <Input className={FIELD_INPUT} />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          <KontaktDatePicker
            name={`kontakte.${rolle}.einwilligung.datum`}
            path={`kontakte.${rolle}.einwilligung`}
            isReadOnly={isMirrored}
            label="Erteilt am"
            calendarLabel={`${label}: Datum der Einwilligung auswählen`}
            value={person.einwilligung.datum}
            onChange={(next) => setEinwilligung({ datum: next })}
            onFieldLeft={onFieldLeft}
          />
        </div>
      </div>
    </>
  );
}

/** The editor's date field, over a plain `YYYY-MM-DD` so nothing in this panel holds a second shape. */
function KontaktDatePicker({
  name,
  path,
  label,
  calendarLabel,
  value,
  isReadOnly,
  onChange,
  onFieldLeft,
}: {
  name: string;
  /** The row the changed marker belongs to, which for a record's part is the record. */
  path: string;
  label: string;
  calendarLabel: string;
  value: string;
  isReadOnly: boolean;
  onChange: (next: string) => void;
  onFieldLeft: (paths: readonly string[]) => void;
}) {
  return (
    <DatePicker
      isReadOnly={isReadOnly}
      value={toCalendarDate(value)}
      // `""` for a cleared date is what the schema rejects with its own German message, so a
      // half-entered record is a field error rather than a silent skip.
      onChange={(next) => onChange(next?.toString() ?? "")}
      onBlur={() => onFieldLeft([name])}
      name={name}
      className="w-full">
      <FieldLabel path={path}>{label}</FieldLabel>
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
          aria-label={calendarLabel}
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
  );
}
