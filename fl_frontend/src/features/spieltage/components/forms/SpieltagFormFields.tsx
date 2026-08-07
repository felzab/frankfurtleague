"use client";

import { parseDate } from "@internationalized/date";

import { FieldError, Input, Label, ListBox, Select, TextField } from "@heroui/react";

import { SaisonDateField, SaisonRuleNumberField } from "@/features/saisons/components/forms/SaisonFormControls";
import { PHASE_LABELS } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { SAISON_PHASE_OPTIONS } from "@/features/spieltage/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { Key } from "@heroui/react";

/**
 * The five fields a matchday carries, shared by the create and edit dialogs.
 *
 * **A dialog rather than a page, and that is the decision this file rests on.** ADR-0050's threshold is a
 * form that OUTGREW a dialog: five scalar controls, no nested object, no junction row and no lookup list
 * do not reach it, and the Spielort form beside it is the same size in the same container.
 *
 * **There is no position control, and adding one would be a regression** (ADR-0064). Where a matchday
 * sits in its season is derived from `saison_phase` and `beginn`, both of which are on this form — so the
 * two fields that decide the order are the two an admin was going to fill in anyway, and a matchday
 * cannot be in the wrong place without one of them being wrong.
 *
 * **The date and number controls are the season slice's**, imported rather than rewritten. A matchday's
 * `beginn`/`ende` pair and a season's `start_date`/`end_date` pair are the same control doing the same
 * job, and writing a second picker is how two date fields in one admin acquire two different popovers.
 * The cross-feature import is legal: that lint is scoped to `core` and `shared` (ADR-0012).
 *
 * `saison_id` is NOT here. The create form supplies it from the page's selected season, and the patch
 * payload does not carry it at all: moving a matchday between seasons would strand its matches, which
 * hold their own `saison_id` and are not rewritten.
 */

/** What both dialogs hold while editing, before either adds its own id or season. */
export type SpieltagFormDraft = {
  name: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  saison_phase: FLSaisonPhase | null;
};

/** The draft holds the payload's own strings and the picker wants a `CalendarDate` — see the season form. */
const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

export function SpieltagFormFields<T extends SpieltagFormDraft>({
  draft,
  onChange,
  errors,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
  /**
   * Server messages keyed by payload path, for a caller outside a `<Form>` context. Left undefined by
   * the `EntityForm` callers, where the context supplies the same messages to the same `<FieldError>`s —
   * the same split `SpielortFormFields` makes.
   */
  errors?: Record<string, string | undefined>;
}) {
  const isEndBeforeStart = draft.beginn !== "" && draft.ende !== "" && draft.ende < draft.beginn;

  return (
    <>
      <TextField
        isRequired
        name="name"
        value={draft.name}
        onChange={(next) => onChange({ ...draft, name: next })}
        // See `SchiedsrichterFormFields` for why the invalid flag lives on the field, not the input.
        isInvalid={errors?.["name"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Name</Label>
        <Input
          placeholder="z.B. 1. Spieltag"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["name"]}</FieldError>
      </TextField>

      <Select
        isRequired
        name="saison_phase"
        aria-label="Phase"
        value={draft.saison_phase ?? undefined}
        onChange={(key: Key | null) => {
          if (!key) return;
          onChange({ ...draft, saison_phase: key.toString() as FLSaisonPhase });
        }}
        isInvalid={errors?.["saison_phase"] ? true : undefined}
        className="w-full">
        <Label className={FIELD_LABEL}>Phase</Label>
        <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
          {/* From the prop, not `Select.Value` — the collection can lag a render behind and would show
              HeroUI's English placeholder. Same reasoning as `ClosedSetSelect`'s trigger. */}
          <span className={draft.saison_phase ? "" : "text-foreground-muted"}>
            {draft.saison_phase === null ? "Phase wählen" : PHASE_LABELS[draft.saison_phase]}
          </span>
          <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
        </Select.Trigger>
        <FieldError className={FIELD_ERROR}>{errors?.["saison_phase"]}</FieldError>
        <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
          <ListBox aria-label="Phasen">
            {SAISON_PHASE_OPTIONS.map((phase) => (
              <ListBox.Item
                key={phase}
                id={phase}
                textValue={PHASE_LABELS[phase]}
                className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                {PHASE_LABELS[phase]}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <div className="flex w-full flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING}>Zeitraum</h3>
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <SaisonDateField
            isRequired
            name="beginn"
            ariaLabel="Beginn auswählen"
            label={<Label className={FIELD_LABEL}>Beginn</Label>}
            value={asCalendarDate(draft.beginn)}
            onChange={(next) => onChange({ ...draft, beginn: next?.toString() ?? "" })}
          />
          <SaisonDateField
            isRequired
            name="ende"
            ariaLabel="Ende auswählen"
            label={<Label className={FIELD_LABEL}>Ende</Label>}
            value={asCalendarDate(draft.ende)}
            onChange={(next) => onChange({ ...draft, ende: next?.toString() ?? "" })}
          />
        </div>
        {isEndBeforeStart && (
          <Callout
            severity="warning"
            title="Das Ende liegt vor dem Beginn">
            Gespeichert wird das trotzdem, weil nichts diese Reihenfolge verlangt.
          </Callout>
        )}
      </div>

      <div className="flex w-full flex-col gap-y-3">
        <h3 className={FORM_SECTION_HEADING}>Umfang</h3>
        <SaisonRuleNumberField
          name="anzahl_spiele"
          label={<Label className={FIELD_LABEL}>Erwartete Spiele</Label>}
          minValue={1}
          value={draft.anzahl_spiele}
          onChange={(anzahl_spiele) => onChange({ ...draft, anzahl_spiele })}
        />

        {/* Where the matchday lands is not a field, so the form says which fields decide it instead
            (ADR-0064). Without this the reader has no way to know the list's order is not arbitrary. */}
        <Callout
          severity="info"
          title="Die Position ergibt sich aus Phase und Beginn">
          Der Spieltag wird automatisch dort einsortiert. Es gibt keine Reihenfolge einzutragen: um ihn zu verschieben, ändere sein Datum.
        </Callout>
      </div>
    </>
  );
}
