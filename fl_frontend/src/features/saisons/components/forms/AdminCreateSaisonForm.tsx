"use client";

import { parseDate } from "@internationalized/date";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { postSaisonAction } from "@/features/saisons/actions";
import { SaisonDateField, SaisonRuleNumberField } from "@/features/saisons/components/forms/SaisonFormControls";
import { StufenPicker } from "@/features/saisons/components/forms/StufenPicker";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import type { FLPostSaisonPayload } from "@/features/saisons/schemas";

/**
 * The values a new season starts from.
 *
 * **3/1/0 is a default here and nowhere else.** ADR-0019 refused a hardcoded scoring rule inside the
 * league table's derivation, and this is the opposite of that: it is the starting value of an editable
 * field the admin sees before submitting, and what lands in the document is what they submitted. What
 * that ADR forbids is a constant the *reader* cannot see — a season whose points are implied rather than
 * stored.
 *
 * `erlaubte_stufen` starts as the whole league, because narrowing is the unusual choice and a picker that
 * started empty would make every create a six-press exercise.
 */
const EMPTY_DRAFT: FLPostSaisonPayload = {
  id: "",
  start_date: "",
  end_date: "",
  rules: {
    win_points: 3,
    draw_points: 1,
    qualifiers_per_group: 2,
    number_of_groups: 2,
    teams_per_group: 5,
    erlaubte_stufen: [...STUFE_OPTIONS],
  },
};

/**
 * The draft holds the payload's own strings and the picker wants a `CalendarDate`, so the boundary is
 * here. Safe rather than lenient: the only writer is the picker's `onChange`, which produces
 * `CalendarDate.toString()` — exactly the `YYYY-MM-DD` `parseDate` accepts — and `""` is the empty state.
 */
const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

/**
 * Creates a season. It is always created `future` and never `active` — making it live is a separate,
 * deliberate step on the season's own page, so an ordinary typo in a new season's id cannot become a
 * silent rollover of the live one (ADR-0026).
 *
 * **The id is typed rather than generated**, which makes this the one create form in the app that asks
 * for a key. `saisons._id` is the four-character string every `saison_id` in the database references, so
 * the field carries the length bound and the browser refuses a fifth keystroke; a reused id comes back as
 * a 409 that the action turns into a message on this field.
 */
export function AdminCreateSaisonForm({ onClose }: { onClose: () => void }) {
  return (
    <EntityForm<FLPostSaisonPayload>
      initialDraft={EMPTY_DRAFT}
      renderFields={(draft, setDraft) => (
        <>
          <TextField
            isRequired
            name="id"
            value={draft.id}
            onChange={(next) => setDraft((current) => ({ ...current, id: next }))}
            maxLength={SAISON_ID_LENGTH}>
            <Label className={FIELD_LABEL}>Saison-ID</Label>
            <Input
              placeholder="z.B. 2526"
              className={`${FIELD_INPUT} font-extrabold tracking-wider`}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          {/* The one thing about the id a reader cannot work out from the field itself: every match and
              matchday of the season points at it, and there is no rename. */}
          <Callout
            severity="info"
            title="Die Saison-ID lässt sich später nicht ändern">
            Jedes Spiel und jeder Spieltag der Saison verweist auf sie. Vier Zeichen, üblich sind die beiden Jahreszahlen.
          </Callout>

          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
            <SaisonDateField
              isRequired
              name="start_date"
              ariaLabel="Beginn auswählen"
              label={<Label className={FIELD_LABEL}>Beginn</Label>}
              value={asCalendarDate(draft.start_date)}
              onChange={(next) => setDraft((current) => ({ ...current, start_date: next?.toString() ?? "" }))}
            />
            <SaisonDateField
              isRequired
              name="end_date"
              ariaLabel="Ende auswählen"
              label={<Label className={FIELD_LABEL}>Ende</Label>}
              value={asCalendarDate(draft.end_date)}
              onChange={(next) => setDraft((current) => ({ ...current, end_date: next?.toString() ?? "" }))}
            />
          </div>

          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Punkte</h3>
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
              <SaisonRuleNumberField
                name="rules.win_points"
                label={<Label className={FIELD_LABEL}>Sieg</Label>}
                minValue={1}
                value={draft.rules.win_points}
                onChange={(win_points) => setDraft((current) => ({ ...current, rules: { ...current.rules, win_points } }))}
              />
              <SaisonRuleNumberField
                name="rules.draw_points"
                label={<Label className={FIELD_LABEL}>Unentschieden</Label>}
                minValue={0}
                value={draft.rules.draw_points}
                onChange={(draw_points) => setDraft((current) => ({ ...current, rules: { ...current.rules, draw_points } }))}
              />
            </div>
          </div>

          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Aufbau</h3>
            <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
              <SaisonRuleNumberField
                name="rules.number_of_groups"
                label={<Label className={FIELD_LABEL}>Gruppen</Label>}
                minValue={1}
                // The closed set is A to D and this picks a prefix of it, so 4 is the ceiling rather
                // than a policy — a fifth group has no letter to be.
                maxValue={4}
                value={draft.rules.number_of_groups}
                onChange={(number_of_groups) => setDraft((current) => ({ ...current, rules: { ...current.rules, number_of_groups } }))}
              />
              <SaisonRuleNumberField
                name="rules.teams_per_group"
                label={<Label className={FIELD_LABEL}>Teams pro Gruppe</Label>}
                minValue={1}
                value={draft.rules.teams_per_group}
                onChange={(teams_per_group) => setDraft((current) => ({ ...current, rules: { ...current.rules, teams_per_group } }))}
              />
              <SaisonRuleNumberField
                name="rules.qualifiers_per_group"
                label={<Label className={FIELD_LABEL}>Qualifikanten</Label>}
                minValue={1}
                value={draft.rules.qualifiers_per_group}
                onChange={(qualifiers_per_group) => setDraft((current) => ({ ...current, rules: { ...current.rules, qualifiers_per_group } }))}
              />
            </div>
          </div>

          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Erlaubte Stufen</h3>
            <StufenPicker
              name="rules.erlaubte_stufen"
              value={draft.rules.erlaubte_stufen}
              onChange={(erlaubte_stufen) => setDraft((current) => ({ ...current, rules: { ...current.rules, erlaubte_stufen } }))}
            />
          </div>
        </>
      )}
      onSubmit={async (draft) => {
        const res = await postSaisonAction(draft);
        // A create only counts if the backend echoed the new id back.
        return { ...res, success: res.success && !!res.created_id };
      }}
      marksRequired
      successMessage="Saison angelegt"
      onClose={onClose}
    />
  );
}
