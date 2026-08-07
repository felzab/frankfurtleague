"use client";

import { parseDate } from "@internationalized/date";

import { FieldError, Input, Label, ListBox, Select, TextField } from "@heroui/react";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { Key } from "@heroui/react";

/**
 * The four fields a matchday carries, shared by the create and edit dialogs.
 *
 * **A dialog rather than a page, and that is the decision this file rests on.** ADR-0050's threshold is a
 * form that OUTGREW a dialog: four scalar controls, no nested object, no junction row and no lookup list
 * do not reach it, and the Spielort form beside it is the same size in the same container.
 *
 * **Neither the position nor the match count is a control, and adding either would be a regression**
 * (ADR-0064, ADR-0065). Where a matchday sits in its season is derived from `saison_phase` and `beginn`,
 * both of which are on this form; how many matches it expects is derived from the season's rules and that
 * same phase. So the fields that decide both are ones an admin was going to fill in anyway, and neither
 * derived value can be wrong without one of them being wrong.
 *
 * **The date control is the season slice's**, imported rather than rewritten. A matchday's
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
        {/* Refused by the payload schema in the browser and by the model validator at the endpoint
            (owner, 2026-08-08). Said here too, because a matchday's `beginn` also decides where it sits
            in the season's list — a reversed span is a matchday disagreeing with itself about that. */}
        {isEndBeforeStart && (
          <Callout
            severity="danger"
            title="Das Ende liegt vor dem Beginn">
            So lässt sich der Spieltag nicht speichern.
          </Callout>
        )}
      </div>

      {/* Neither the position nor the expected match count is a field, so the form names what decides
          each of them instead (ADR-0064, ADR-0065). Without this the reader has no way to know the
          list's order is not arbitrary, or where the `x / y` count on each row comes from. */}
      <Callout
        severity="info"
        title="Position und erwartete Spiele ergeben sich von selbst">
        Einsortiert wird nach Phase und Beginn — um den Spieltag zu verschieben, ändere sein Datum. Wie viele Spiele er umfasst, folgt aus den
        Regeln der Saison: bei einer einfachen Hin-Runde pro Gruppe steht die Zahl fest.
      </Callout>
    </>
  );
}
