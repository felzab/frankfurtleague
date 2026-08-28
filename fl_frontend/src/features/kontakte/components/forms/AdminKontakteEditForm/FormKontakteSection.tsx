"use client";

import Link from "next/link";

import { parseDate } from "@internationalized/date";

import { Calendar, DateField, DatePicker, FieldError, Input, Switch, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { kontaktSeatPaths } from "@/features/kontakte/kontakteDraftStatus";
import { applySeatPresence, applySharedFlag, mirroredJudgedPaths, mirrorKontakte } from "@/features/kontakte/utils";
import { EINWILLIGUNG_HERKUNFT_OPTIONS, KONTAKT_ROLLEN } from "@/features/teams/constants";
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
  TOGGLE_GROUP_ALIGN,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { KontaktRolle } from "@/features/teams/constants";
import type { FLKontaktEinwilligung } from "@/features/teams/schemas";
import type { KontaktpersonDraft, SaisonTeamKontakteDraft } from "@/features/teams/types";
import type { Key } from "@heroui/react";
import type { CalendarDate } from "@internationalized/date";
import type { KontakteBanner } from "./banners";

/** `FormAustrittSection`'s chip, which the same reasoning about HeroUI's layered fills produced. */
const HERKUNFT_CHIP =
  "border-border bg-transparent text-foreground-muted " +
  "data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground " +
  "data-[selected=true]:ring-brand-solid-foreground " +
  "fluid-xs h-9 rounded-lg border px-4 font-extrabold tracking-wide transition-colors";

/** The empty string is a date nobody has entered yet, which the picker has to show as empty rather than refuse. */
function toCalendarDate(stored: string): CalendarDate | null {
  return stored === "" ? null : parseDate(stored);
}

/** Every path the three seats report under. Module scope: the set is the same on every render. */
const ALL_SEAT_PATHS = KONTAKT_ROLLEN.flatMap(({ value }) => kontaktSeatPaths(value));

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
  /** Judged with the value that arrived in the event, because state has not committed yet. */
  onValidateSelection: (paths: readonly string[], selected: { kontakte: SaisonTeamKontakteDraft | null }) => void;
}) {
  const panel = formPanel();

  /**
   * Re-judged wherever a switch RESOLVES what a seat holds. All three paths sets, because
   * `mirrorKontakte` moves two seats at once.
   */
  const revalidateSeats = (next: SaisonTeamKontakteDraft | null) => onValidateSelection(ALL_SEAT_PATHS, { kontakte: next });

  /** The Ansprechperson seat tracks the trainer, so no judgement of a trainer field may leave its copy behind. */
  const isMirroring = value?.trainer_ist_ansprechperson === true;

  const judgeFieldsLeft = (paths: readonly string[]) => onFieldLeft(mirroredJudgedPaths(paths, isMirroring));

  const applyPerson = (rolle: KontaktRolle, person: KontaktpersonDraft) => {
    if (value === null) return;
    onChange(mirrorKontakte({ ...value, [rolle]: person }));
  };

  /** Whether the seat holds anybody. A pick, so it is judged on the press rather than on a blur. */
  const setPresence = (rolle: KontaktRolle, present: boolean) => {
    if (value === null) return;
    const { next, revalidate } = applySeatPresence(value, rolle, present);

    onChange(next);
    if (revalidate) revalidateSeats(next);
  };

  /** Judged on the pick, as every picked field is, and on the value `mirrorKontakte` would store. */
  const pickHerkunft = (rolle: KontaktRolle, erteilt_von: FLKontaktEinwilligung["erteilt_von"]) => {
    const seat = value?.[rolle] ?? null;
    if (value === null || seat === null) return;
    const person = { ...seat, einwilligung: { ...seat.einwilligung, erteilt_von } };
    const next = mirrorKontakte({ ...value, [rolle]: person });

    onChange(next);
    onValidateSelection(mirroredJudgedPaths([`kontakte.${rolle}.einwilligung.erteilt_von`], isMirroring), { kontakte: next });
  };

  /**
   * Read-only rather than hidden. The flag is an assertion the backend never checks, so a stored row
   * can hold it over two DIFFERENT people, and a hidden block leaves that second person one
   * keystroke from being overwritten unseen.
   */
  const isMirrored = (rolle: KontaktRolle) => rolle === "ansprechperson" && isMirroring;

  const toggleBlock = (present: boolean) => {
    const next = present ? buildEmptyKontakte() : null;

    onChange(next);
    if (!present) revalidateSeats(next);
  };

  const toggleShared = (shared: boolean) => {
    if (value === null) return;
    const { next, revalidate } = applySharedFlag(value, shared);

    onChange(next);
    if (revalidate) revalidateSeats(next);
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Kontakte
          <Hint
            mode="reveal"
            label="Hinweis zu den Kontakten"
            body={{
              lead: "Wer für dieses Team in dieser Saison erreichbar ist.",
              points: [{ term: "Diese Angaben", text: "bleiben in der Verwaltung und erscheinen nirgends öffentlich." }],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="kontakte-block"
        />

        {!isMember && (
          // A link and no control: the seats hang off a season membership, and entering one is the
          // club page's write rather than this page's.
          <Link
            href={teamHref}
            className="text-brand hover:text-brand-solid fluid-sm w-fit font-bold transition-colors">
            Zur Seite des Teams
          </Link>
        )}

        {isMember && (
          <Switch
            isSelected={value !== null}
            onChange={toggleBlock}>
            <Switch.Content className={panel.switchContent()}>
              Kontakte hinterlegt
              <Switch.Control className={panel.switchControl()}>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        )}

        {isMember && value !== null && (
          <>
            <Switch
              name="kontakte.trainer_ist_ansprechperson"
              isSelected={value.trainer_ist_ansprechperson}
              onChange={toggleShared}>
              <Switch.Content className={panel.switchContent()}>
                Trainer ist zugleich Ansprechperson
                <Switch.Control className={panel.switchControl()}>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>

            {KONTAKT_ROLLEN.map(({ value: rolle, label }) => (
              <KontaktpersonFields
                key={rolle}
                rolle={rolle}
                label={label}
                person={value[rolle]}
                isMirrored={isMirrored(rolle)}
                onPresenceChange={(present) => setPresence(rolle, present)}
                onChange={(person) => applyPerson(rolle, person)}
                onFieldLeft={judgeFieldsLeft}
                onHerkunftPicked={(erteilt_von) => pickHerkunft(rolle, erteilt_von)}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * One seat: its own switch, and beneath it the person and the agreement, or nothing. Empty renders as
 * the switch alone — the record says a seat holds nobody, never why, so no wording here may either.
 */
function KontaktpersonFields({
  rolle,
  label,
  person,
  isMirrored,
  onPresenceChange,
  onChange,
  onFieldLeft,
  onHerkunftPicked,
}: {
  rolle: KontaktRolle;
  label: string;
  /** Null where the seat holds nobody, which is a saveable state rather than a half-finished one. */
  person: KontaktpersonDraft | null;
  /** This seat tracks the trainer, so its boxes read out rather than take input. */
  isMirrored: boolean;
  onPresenceChange: (present: boolean) => void;
  onChange: (next: KontaktpersonDraft) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  onHerkunftPicked: (erteilt_von: FLKontaktEinwilligung["erteilt_von"]) => void;
}) {
  const panel = formPanel();

  return (
    <div className="border-border flex w-full flex-col gap-y-4 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className={FORM_SECTION_HEADING}>{label}</h3>

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
          onHerkunftPicked={onHerkunftPicked}
        />
      )}
    </div>
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
  onHerkunftPicked,
}: {
  rolle: KontaktRolle;
  label: string;
  person: KontaktpersonDraft;
  isMirrored: boolean;
  onChange: (next: KontaktpersonDraft) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  onHerkunftPicked: (erteilt_von: FLKontaktEinwilligung["erteilt_von"]) => void;
}) {
  // `ToggleButtonGroup` takes no `name`, so the proxy field below is what carries its refusal; the id
  // names the group without pulling the changed-field marker into that name.
  const herkunftLabelId = `kontakte-${rolle}-einwilligung-herkunft`;

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
          onBlur={() => onFieldLeft([`kontakte.${rolle}.vorname`])}>
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
          onBlur={() => onFieldLeft([`kontakte.${rolle}.nachname`])}>
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
          value={person.geburtsdatum}
          onChange={(next) => onChange({ ...person, geburtsdatum: next })}
          onFieldLeft={onFieldLeft}
        />
      </div>

      <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
        <h4 className={FORM_SECTION_HEADING}>Einwilligung</h4>

        <TextField
          name={`kontakte.${rolle}.einwilligung.erteilt_von`}
          value={person.einwilligung.erteilt_von ?? ""}
          onChange={() => undefined}
          className="flex w-full flex-col gap-y-1">
          {/* A `Label` and not a plain span: it names the enclosing `TextField`, which carries no
              `aria-label`, so `useLabel` would warn without it. */}
          <FieldLabel path={`kontakte.${rolle}.einwilligung`}>
            <span id={herkunftLabelId}>Erteilt</span>
          </FieldLabel>
          <ToggleButtonGroup
            isDisabled={isMirrored}
            aria-labelledby={herkunftLabelId}
            size="sm"
            isDetached
            selectionMode="single"
            // Empty is reachable only before the first press, which is the state the schema refuses;
            // afterwards the admin swaps it rather than clearing it.
            disallowEmptySelection
            selectedKeys={person.einwilligung.erteilt_von === null ? [] : [person.einwilligung.erteilt_von]}
            onSelectionChange={(keys: Set<Key>) => {
              const [picked] = [...keys].map(String);
              if (picked !== undefined) onHerkunftPicked(picked as FLKontaktEinwilligung["erteilt_von"]);
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
            {EINWILLIGUNG_HERKUNFT_OPTIONS.map((option) => (
              <ToggleButton
                key={option.value}
                id={option.value}
                className={HERKUNFT_CHIP}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input className="hidden" />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        <div className={FIELD_PAIR}>
          <TextField
            isReadOnly={isMirrored}
            isRequired
            name={`kontakte.${rolle}.einwilligung.text_version`}
            value={person.einwilligung.text_version}
            onChange={(next) => setEinwilligung({ text_version: next })}
            onBlur={() => onFieldLeft([`kontakte.${rolle}.einwilligung.text_version`])}>
            <FieldLabel path={`kontakte.${rolle}.einwilligung`}>Unterschriebene Fassung</FieldLabel>
            <Input
              placeholder="z.B. 2025-08"
              className={FIELD_INPUT}
            />
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
