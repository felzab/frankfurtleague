"use client";

import { parseDate } from "@internationalized/date";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { postSaisonAction } from "@/features/saisons/actions";
import {
  SaisonCountSelect,
  SaisonDateField,
  SaisonRuleNumberField,
  SaisonTiebreakSelect,
} from "@/features/saisons/components/forms/SaisonFormControls";
import { StufenPicker } from "@/features/saisons/components/forms/StufenPicker";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { FLPostSaisonPayloadSchema } from "@/features/saisons/schemas";
import { groupCountOptions, MAX_TEAMS_PER_GROUP, qualifierCountOptions, teamsPerGroupFloor } from "@/features/saisons/shapeOffer";
import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { EntityForm } from "@/shared/components/ui/EntityForm";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR, FIELD_TRIO, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { SaisonCreateDraft, SaisonGruppenOccupancy } from "@/features/saisons/types";

/**
 * **Every value here is a default HERE and nowhere else**: the live season's numbers, as the starting
 * value of an editable field the admin sees. What is forbidden is a constant the reader cannot see,
 * which is why no field carries a model default.
 */
const EMPTY_DRAFT: SaisonCreateDraft = {
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
 * A season being created holds no club, which is the `occupancy_by_gruppe={}` `post_saison` hands
 * `find_rules_refusal`. Passed rather than defaulted in the offer: a caller that forgot it would build
 * an editor's picker against a season whose groups nobody counted.
 */
const NO_GRUPPEN_OCCUPANCY: SaisonGruppenOccupancy = {};

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
    <EntityForm<SaisonCreateDraft>
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
              placeholder="z.B. 2027"
              className={`${FIELD_INPUT} font-extrabold tracking-wider`}
            />
            <FieldError className={FIELD_ERROR} />
          </TextField>

          {/* Two things about the id the field itself cannot carry: it is a calendar year rather than
              a school year (`fl_frontend/src/features/bewerbungen/utils.ts :: abiJahrgang`), and a
              wrong one cannot be renamed away. */}
          <Callout
            severity="info"
            title="Die Saison-ID lässt sich später nicht ändern">
            Die ID ist das Kalenderjahr, in dem gespielt wird, und kein Schuljahr: Die Saison im Jahr 2027 bekommt die ID 2027.
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

          {/* Grouped as the season editor groups them, so the two forms describe one set of rules. */}
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

          {/* Its own group and never under the points above, as the season editor has it: this
              re-sorts a table the points scored. */}
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
            {/* The season editor's own offer, from `fl_frontend/src/features/saisons/shapeOffer.ts`: this
                dialog creates a season the editor then edits, so the two may not disagree about which
                shapes exist. */}
            <div className={FIELD_TRIO}>
              <SaisonCountSelect
                name="rules.number_of_groups"
                ariaLabel="Gruppen"
                label={<Label className={FIELD_LABEL}>Gruppen</Label>}
                value={draft.rules.number_of_groups}
                options={groupCountOptions({
                  groups: draft.rules.number_of_groups,
                  qualifiers: draft.rules.qualifiers_per_group,
                  occupancy: NO_GRUPPEN_OCCUPANCY,
                })}
                onChange={(number_of_groups) => setDraft((current) => ({ ...current, rules: { ...current.rules, number_of_groups } }))}
              />
              <SaisonRuleNumberField
                name="rules.teams_per_group"
                label={<Label className={FIELD_LABEL}>Teams pro Gruppe</Label>}
                minValue={teamsPerGroupFloor({
                  qualifiers: draft.rules.qualifiers_per_group,
                  held: draft.rules.teams_per_group,
                  occupancy: NO_GRUPPEN_OCCUPANCY,
                })}
                maxValue={MAX_TEAMS_PER_GROUP}
                value={draft.rules.teams_per_group}
                onChange={(teams_per_group) => setDraft((current) => ({ ...current, rules: { ...current.rules, teams_per_group } }))}
              />
              <SaisonCountSelect
                name="rules.qualifiers_per_group"
                ariaLabel="Qualifikanten pro Gruppe"
                label={<Label className={FIELD_LABEL}>Qualifikanten pro Gruppe</Label>}
                value={draft.rules.qualifiers_per_group}
                options={qualifierCountOptions({
                  groups: draft.rules.number_of_groups,
                  qualifiers: draft.rules.qualifiers_per_group,
                  teams: draft.rules.teams_per_group,
                })}
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
      schema={FLPostSaisonPayloadSchema}
      toPayload={(draft) => draft}
      onSubmit={async (draft) => {
        const res = await postSaisonAction(draft);
        // An acknowledged create that answered no id leaves the caller nothing to name, so the
        // shared refusal stands in for a sentence the action never composed.
        return res.success && res.created_id === undefined ? { success: false, error: UNKNOWN_REFUSAL } : res;
      }}
      marksRequired
      successMessage="Saison angelegt"
      onClose={onClose}
    />
  );
}
