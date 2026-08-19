"use client";

import { parseDate } from "@internationalized/date";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { PHASE_LABELS } from "@/features/saisons/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { SpieltagPhaseOffer } from "@/features/spieltage/utils";
import type { Key } from "@heroui/react";

/**
 * The three fields a matchday carries, shared by the create and edit dialogs. **The date control is
 * the season slice's**, imported rather than rewritten — the cross-feature import is legal because
 * that lint is scoped to `core` and `shared`.
 */

/** What both dialogs hold while editing, before either adds its own id or season. */
export type SpieltagFormDraft = {
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
  saisonSpan,
  phaseOffer,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
  /**
   * Every phase with this season's expected match count, and whether the attached fixtures still fit
   * (`REQ-SPIELTAG-002`). The counts are the SERVED schedule, not arithmetic repeated here.
   */
  phaseOffer: readonly SpieltagPhaseOffer[];
  /**
   * The season's own span, which bounds both pickers below (`REQ-DATE-002`): greying the days out
   * means the admin never picks one the endpoint would refuse.
   */
  saisonSpan?: { start: string; end: string };
  /**
   * Server messages keyed by payload path, for a caller outside a `<Form>` context. Left undefined by
   * the `EntityForm` callers, where the context supplies the same messages.
   */
  errors?: Record<string, string | undefined>;
}) {
  const isEndBeforeStart = draft.beginn !== "" && draft.ende !== "" && draft.ende < draft.beginn;

  // Parsed once for both pickers. `undefined` where no span was passed, which leaves the calendar
  // unbounded rather than bounded to nothing.
  const spanStart = saisonSpan ? parseDate(saisonSpan.start) : undefined;
  const spanEnd = saisonSpan ? parseDate(saisonSpan.end) : undefined;

  return (
    <>
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
            {phaseOffer.map(({ phase, expected, fits }) => (
              <ListBox.Item
                key={phase}
                id={phase}
                textValue={PHASE_LABELS[phase]}
                /* Visible and disabled rather than hidden, the treatment `GruppeSelect` gives a full
                   group: an admin should see why a phase cannot be picked (`REQ-SPIELTAG-002`). */
                isDisabled={!fits}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200 data-disabled:cursor-not-allowed data-disabled:opacity-40">
                {PHASE_LABELS[phase]}
                {/* The expected count, always: it answers "why is that one disabled" and "how many
                    matches does this phase hold" in the same two characters. */}
                <span className="fluid-xs text-foreground-muted font-semibold">{expected} Sp.</span>
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
            minValue={spanStart}
            maxValue={spanEnd}
            ariaLabel="Beginn auswählen"
            label={<Label className={FIELD_LABEL}>Beginn</Label>}
            value={asCalendarDate(draft.beginn)}
            onChange={(next) => onChange({ ...draft, beginn: next?.toString() ?? "" })}
          />
          <SaisonDateField
            isRequired
            name="ende"
            minValue={spanStart}
            maxValue={spanEnd}
            ariaLabel="Ende auswählen"
            label={<Label className={FIELD_LABEL}>Ende</Label>}
            value={asCalendarDate(draft.ende)}
            onChange={(next) => onChange({ ...draft, ende: next?.toString() ?? "" })}
          />
        </div>
        {/* Refused by the payload schema and by the model validator, and said here too because a
            matchday's `beginn` also decides where it sits in the season's list — a reversed span is
            a matchday disagreeing with itself. */}
        {isEndBeforeStart && (
          <Callout
            severity="danger"
            title="Das Ende liegt vor dem Beginn">
            So lässt sich der Spieltag nicht speichern.
          </Callout>
        )}
      </div>

      {/* Neither the position nor the expected match count is a field, so the form names what decides
          each of them instead. Without this the reader has no way to know the
          list's order is not arbitrary, or where the `x / y` count on each row comes from. */}
      <Callout
        severity="info"
        title="Name, Position und erwartete Spiele ergeben sich von selbst">
        Der Spieltag heißt nach seiner Phase und seiner Position darin. In der Gruppenphase sind das „1. Spieltag“, „2. Spieltag“, danach ist es
        der Name der Runde. Einsortiert wird nach Phase und Beginn, also verschiebst Du ihn über sein Datum. Und wie viele Spiele er umfasst,
        folgt aus den Regeln der Saison: bei einer einfachen Hin-Runde pro Gruppe steht die Zahl fest.
      </Callout>
    </>
  );
}
