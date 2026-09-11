"use client";

import { parseDate } from "@internationalized/date";

import { Calendar, DateField, DatePicker, FieldError, Input, Label, TextField } from "@heroui/react";

import { postSpielerAction } from "@/features/spieler/actions";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { TeamSelect } from "@/features/spieler/components/forms/TeamSelect";
import { NUMMER_MAX_LENGTH, NUMMER_MUST_BE_DIGITS, POSITION_OPTIONS } from "@/features/spieler/constants";
import { FLCreateSpielerFormPayloadSchema } from "@/features/spieler/schemas";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import {
  DATE_PICKER_CALENDAR,
  DATE_PICKER_PLACEMENT,
  DATE_PICKER_POPOVER,
  FIELD_ERROR,
  FIELD_GROUP,
  FIELD_INPUT,
  FIELD_LABEL,
  FIELD_PAIR,
} from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { SaisonSelect } from "@/shared/components/ui/SaisonSelect";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { SpielerCreateDraft, SpielerCreateSaisonOption } from "@/features/spieler/types";

const EMPTY_DRAFT_BASE = {
  vorname: "",
  nachname: null,
  geburtsdatum: null,
  team_id: null,
  nummer: null,
  position: null,
  stufe: null,
  // A new entry never carries a role — that is a decision about an existing squad, made on the
  // player's own page.
  rolle: null,
} as const;

/**
 * Creates the player AND puts them in a squad in one submit. One form on purpose: the public squad
 * read narrows by team and season, which joins the junction strictly, so a player with no row reaches
 * no public page.
 */
export function AdminCreateSpielerForm({
  saisonOptions,
  defaultSaisonId,
  onClose,
}: {
  saisonOptions: SpielerCreateSaisonOption[];
  defaultSaisonId: string;
  onClose: () => void;
}) {
  return (
    <EntityForm<SpielerCreateDraft>
      initialDraft={{
        ...EMPTY_DRAFT_BASE,
        saison_id: defaultSaisonId,
        // Derived from the season's status, never asked; the note under the fields says what was decided.
        is_nachgetragen: saisonOptions.find((option) => option.saisonId === defaultSaisonId)?.isNachgetragen ?? false,
      }}
      renderFields={(draft, setDraft) => {
        const selectedOption = saisonOptions.find((option) => option.saisonId === draft.saison_id) ?? saisonOptions[0];
        const teams = selectedOption?.teams ?? [];

        return (
          <>
            <div className={FIELD_PAIR}>
              <TextField
                isRequired
                name="vorname"
                value={draft.vorname}
                onChange={(next) => setDraft((current) => ({ ...current, vorname: next }))}>
                <Label className={FIELD_LABEL}>Vorname</Label>
                <Input
                  placeholder="z.B. Lena"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>

              {/* Required on the CREATE only — the column and the patch stay nullable for imported rows. */}
              <TextField
                isRequired
                name="nachname"
                value={draft.nachname ?? ""}
                // Emptied means absent, not an empty surname — the boundary where `""` becomes null.
                onChange={(next) => setDraft((current) => ({ ...current, nachname: next.trim() === "" ? null : next }))}>
                <Label className={FIELD_LABEL}>Nachname</Label>
                <Input
                  placeholder="z.B. Meier"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>
            </div>

            <div className={FIELD_PAIR}>
              {/* Its own row rather than a third name column: this is the person, and the pair below
                  is the season's squad row. */}
              <DatePicker
                name="geburtsdatum"
                value={draft.geburtsdatum === null ? null : parseDate(draft.geburtsdatum)}
                // A cleared picker is `null`, which is what the payload stores: no date was given.
                onChange={(next) => setDraft((current) => ({ ...current, geburtsdatum: next?.toString() ?? null }))}
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
                  {/* No span: the calendar greys out what is offered, and this form judges no age
                      (`fl_backend/app/core/domain.py :: UNENFORCED`). */}
                  <Calendar
                    aria-label="Geburtsdatum auswählen"
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

            <div className={FIELD_PAIR}>
              <SaisonSelect
                value={draft.saison_id}
                onChange={(nextSaisonId) => {
                  const nextOption = saisonOptions.find((option) => option.saisonId === nextSaisonId);
                  setDraft((current) => ({
                    ...current,
                    saison_id: nextSaisonId,
                    // Follows the season, never the previous choice — that season's answer, not a
                    // preference the admin carries.
                    is_nachgetragen: nextOption?.isNachgetragen ?? false,
                    // A team from another season must not ride along silently, and no more may one the
                    // next season has no room in — the picker returns to "wählen" instead.
                    team_id:
                      current.team_id !== null &&
                      (nextOption?.teams ?? []).some((team) => team.teamId === current.team_id && team.isSquadFull !== true)
                        ? current.team_id
                        : null,
                    // Same rule: the form must not submit a level its own picker never showed.
                    stufe: current.stufe !== null && (nextOption?.erlaubteStufen ?? []).includes(current.stufe) ? current.stufe : null,
                  }));
                }}
                saisonIds={saisonOptions.map((option) => option.saisonId)}
              />

              <TeamSelect
                isRequired
                value={draft.team_id}
                onChange={(teamId) => setDraft((current) => ({ ...current, team_id: teamId }))}
                teams={teams}
              />
            </div>

            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              <TextField
                name="nummer"
                value={draft.nummer ?? ""}
                // Emptied means absent, not a number nobody wears — the same boundary rule as `nachname`.
                onChange={(next) => setDraft((current) => ({ ...current, nummer: next.trim() === "" ? null : next }))}
                maxLength={NUMMER_MAX_LENGTH}
                inputMode="numeric"
                pattern="[0-9]*">
                <Label className={FIELD_LABEL}>Nummer</Label>
                <Input
                  placeholder="z.B. 7"
                  className={`${FIELD_INPUT} font-extrabold tracking-wider`}
                />
                <FieldError className={FIELD_ERROR}>
                  {/* Only the format, which is OUR rule. Every other flag keeps the browser's own sentence in the
                      reader's language, as `SaisonFormControls.tsx :: SaisonDateField` sets out. */}
                  {({ validationDetails, validationErrors }) =>
                    validationDetails.patternMismatch ? NUMMER_MUST_BE_DIGITS : validationErrors.join(" ")
                  }
                </FieldError>
              </TextField>

              <ClosedSetSelect
                value={draft.position}
                onChange={(position) => setDraft((current) => ({ ...current, position }))}
                options={POSITION_OPTIONS}
                name="position"
                label="Position"
                placeholder="Keine Angabe"
              />

              <ClosedSetSelect
                value={draft.stufe}
                onChange={(stufe) => setDraft((current) => ({ ...current, stufe }))}
                options={selectedOption?.erlaubteStufen ?? []}
                name="stufe"
                label="Stufe"
                placeholder="Keine Angabe"
              />
            </div>

            {draft.is_nachgetragen && (
              <p className="fluid-xxs text-foreground-muted font-medium">
                Diese Person wird nachgetragen. Zu Beginn der Saison war sie nicht im Kader.
              </p>
            )}
          </>
        );
      }}
      schema={FLCreateSpielerFormPayloadSchema}
      toPayload={(draft) => draft}
      onSubmit={async (draft) => {
        const res = await postSpielerAction(draft);
        // An acknowledged create that answered no id leaves the caller nothing to name, so the
        // shared refusal stands in for a sentence the action never composed.
        return res.success && res.spieler_id === undefined ? { success: false, error: UNKNOWN_REFUSAL } : res;
      }}
      marksRequired
      successMessage="Spieler angelegt"
      onClose={onClose}
    />
  );
}
