"use client";

import { parseDate } from "@internationalized/date";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { postSaisonAction } from "@/features/saisons/actions";
import { SaisonDateField, SaisonRuleNumberField, SaisonTiebreakSelect } from "@/features/saisons/components/forms/SaisonFormControls";
import { StufenPicker } from "@/features/saisons/components/forms/StufenPicker";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR, FIELD_TRIO, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";

import type { FLPostSaisonPayload } from "@/features/saisons/schemas";

/**
 * **Every value here is a default HERE and nowhere else**: the live season's numbers, as the starting
 * value of an editable field the admin sees. What is forbidden is a constant the reader cannot see,
 * which is why no field carries a model default.
 */
const EMPTY_DRAFT: FLPostSaisonPayload = {
  id: "",
  start_date: "",
  end_date: "",
  // The explicit null the payload demands rather than an omitted key: this dialog offers no control
  // over the window, which is opened on the new season's own page.
  bewerbung: null,
  rules: {
    win_points: 3,
    draw_points: 1,
    qualifiers_per_group: 2,
    number_of_groups: 2,
    teams_per_group: 5,
    tiebreak_order: "tordifferenz",
    max_kadergroesse: 50,
    forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
    erlaubte_stufen: [...STUFE_OPTIONS],
  },
};

/**
 * Safe rather than lenient: the only writer is the picker's `onChange`, which produces exactly the
 * `YYYY-MM-DD` that `parseDate` accepts.
 */
const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

/** Names the forfeit pair for a screen reader, the heading over it belonging to no control of its own. */
const FORFEIT_LABEL_ID = "neue-saison-nichtantreten";

/** Names the level chips for a screen reader, `ToggleButtonGroup` carrying its own role and no label element. */
const STUFEN_LABEL_ID = "neue-saison-erlaubte-stufen";

/**
 * Creates a season, always `future`: making one live is a separate deliberate step, so a typo in a new
 * id cannot become a silent rollover of the live one. **The id is typed rather than generated** — the
 * one create form that asks for a key.
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

          {/* The one thing about the id a reader cannot work out from the field itself: there is no rename. */}
          <Callout
            severity="info"
            title="Die Saison-ID lässt sich später nicht ändern">
            Üblich sind die beiden Jahreszahlen: 2526 steht für die Saison 2025/26.
          </Callout>

          <div className={FIELD_PAIR}>
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

          {/* Grouped as the season editor groups them, so the two forms describe one set of rules:
              all four say what a single fixture is worth. */}
          {/* The dialog's own step between children, which is the ceiling here: a wider break inside
              this group would part the pair further than whole groups are parted. */}
          <div className="flex w-full flex-col gap-y-4">
            <div className="flex w-full flex-col gap-y-3">
              <h3 className={FORM_SECTION_HEADING}>Wertung eines Spiels</h3>
              <div className={FIELD_PAIR}>
                <SaisonRuleNumberField
                  name="rules.win_points"
                  label={<Label className={FIELD_LABEL}>Punkte für einen Sieg</Label>}
                  minValue={1}
                  value={draft.rules.win_points}
                  onChange={(win_points) => setDraft((current) => ({ ...current, rules: { ...current.rules, win_points } }))}
                />
                <SaisonRuleNumberField
                  name="rules.draw_points"
                  label={<Label className={FIELD_LABEL}>Punkte für ein Unentschieden</Label>}
                  minValue={0}
                  value={draft.rules.draw_points}
                  onChange={(draw_points) => setDraft((current) => ({ ...current, rules: { ...current.rules, draw_points } }))}
                />
              </div>
            </div>

            <div className="flex w-full flex-col gap-y-3">
              {/* The heading recipe and no `Label`: it governs the pair below it rather than any one
                  control, so the pair is named through `aria-labelledby` instead of by a label with
                  nothing to bind to. */}
              <span
                id={FORFEIT_LABEL_ID}
                className={FORM_SECTION_HEADING}>
                Ergebnis eines Spiels, zu dem ein Team nicht antritt
              </span>
              <div
                role="group"
                aria-labelledby={FORFEIT_LABEL_ID}
                className={FIELD_PAIR}>
                <SaisonRuleNumberField
                  name="rules.forfeit_ergebnis.sieger_tore"
                  label={<Label className={FIELD_LABEL}>Tore für den Sieger</Label>}
                  minValue={0}
                  value={draft.rules.forfeit_ergebnis.sieger_tore}
                  onChange={(sieger_tore) =>
                    setDraft((current) => ({
                      ...current,
                      rules: { ...current.rules, forfeit_ergebnis: { ...current.rules.forfeit_ergebnis, sieger_tore } },
                    }))
                  }
                />
                <SaisonRuleNumberField
                  name="rules.forfeit_ergebnis.verlierer_tore"
                  label={<Label className={FIELD_LABEL}>Tore für den Verlierer</Label>}
                  minValue={0}
                  value={draft.rules.forfeit_ergebnis.verlierer_tore}
                  onChange={(verlierer_tore) =>
                    setDraft((current) => ({
                      ...current,
                      rules: { ...current.rules, forfeit_ergebnis: { ...current.rules.forfeit_ergebnis, verlierer_tore } },
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Its own group and never under the points above: this re-sorts a table the points
              scored, which is a different promise from the four numbers over it. */}
          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Tiebreak</h3>
            <SaisonTiebreakSelect
              name="rules.tiebreak_order"
              label={<Label className={FIELD_LABEL}>Was zuerst entscheidet</Label>}
              value={draft.rules.tiebreak_order}
              onChange={(tiebreak_order) => setDraft((current) => ({ ...current, rules: { ...current.rules, tiebreak_order } }))}
            />
          </div>

          <div className="flex w-full flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Aufbau der Saison</h3>
            <div className={FIELD_TRIO}>
              <SaisonRuleNumberField
                name="rules.number_of_groups"
                label={<Label className={FIELD_LABEL}>Gruppen</Label>}
                minValue={1}
                // The closed set is A to D and this picks a prefix, so 4 is a ceiling, not a policy.
                maxValue={4}
                value={draft.rules.number_of_groups}
                onChange={(number_of_groups) => setDraft((current) => ({ ...current, rules: { ...current.rules, number_of_groups } }))}
              />
              <SaisonRuleNumberField
                name="rules.teams_per_group"
                label={<Label className={FIELD_LABEL}>Teams pro Gruppe</Label>}
                // Below 2 a group generates no fixture; above 16 a season-scoped read is truncated
                // and the refusals over it cannot be trusted.
                minValue={2}
                maxValue={16}
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
            <h3 className={FORM_SECTION_HEADING}>Kader</h3>
            <SaisonRuleNumberField
              name="rules.max_kadergroesse"
              label={<Label className={FIELD_LABEL}>Maximale Kadergröße</Label>}
              minValue={1}
              value={draft.rules.max_kadergroesse}
              onChange={(max_kadergroesse) => setDraft((current) => ({ ...current, rules: { ...current.rules, max_kadergroesse } }))}
            />
            <span
              id={STUFEN_LABEL_ID}
              className={FIELD_LABEL}>
              Welche Stufen diese Saison spielen
            </span>
            <StufenPicker
              name="rules.erlaubte_stufen"
              labelledBy={STUFEN_LABEL_ID}
              value={draft.rules.erlaubte_stufen}
              onChange={(erlaubte_stufen) => setDraft((current) => ({ ...current, rules: { ...current.rules, erlaubte_stufen } }))}
            />
          </div>
        </>
      )}
      onSubmit={async (draft) => {
        const res = await postSaisonAction(draft);
        return { ...res, success: res.success && !!res.created_id };
      }}
      marksRequired
      successMessage="Saison angelegt"
      onClose={onClose}
    />
  );
}
