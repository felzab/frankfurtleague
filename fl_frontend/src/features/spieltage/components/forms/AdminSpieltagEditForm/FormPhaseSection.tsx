"use client";

import { FieldError, ListBox, Select } from "@heroui/react";

import { PHASE_LABELS } from "@/features/saisons/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_ERROR, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { SpieltagPhaseOffer, SpieltagPositionOffer } from "@/features/spieltage/utils";
import type { Key } from "@heroui/react";
import type { SpieltagBanner } from "./banners";

/**
 * **A phase accounting for fewer matches than this matchday holds is offered and disabled, never
 * hidden**: `GruppeSelect`'s treatment for a full group, so an admin sees why rather than wondering
 * where it went. The position picker below reads the same way, and the two share a section because
 * a position is a place WITHIN a phase — moving the round moves the slot with it.
 */
export function FormPhaseSection({
  phase,
  onChange,
  phaseOffer,
  position,
  onPositionChange,
  positionOffer,
  banners,
}: {
  phase: FLSaisonPhase | null;
  onChange: (next: FLSaisonPhase) => void;
  /** Every phase with this season's expected match count, and whether the attached fixtures still fit. */
  phaseOffer: readonly SpieltagPhaseOffer[];
  position: number;
  onPositionChange: (next: number) => void;
  /** Every slot of the DRAFT phase, the ones its other matchdays hold marked taken. Empty while no phase is picked. */
  positionOffer: readonly SpieltagPositionOffer[];
  banners: readonly SpieltagBanner[];
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Phase und Position
          <InfoHint label="Hinweis zu Phase und Position">
            <p>Die Runde, zu der dieser Spieltag gehört, und seine Stelle darin.</p>
            <ul>
              <li>
                Beide zusammen ergeben den <strong>Namen</strong>. Der lässt sich nicht eintippen.
              </li>
              <li>Die Zählung beginnt in jeder Phase wieder bei 1. Eine belegte Position ist ausgegraut.</li>
              <li>Wie viele Spiele die Phase umfasst, folgt aus den Regeln der Saison.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={`${panel.body()} gap-y-4`}>
        <InlineBanners
          banners={banners}
          spot="phase"
          isAnnounced
        />

        <Select
          isRequired
          name="saison_phase"
          aria-label="Phase"
          value={phase ?? undefined}
          onChange={(key: Key | null) => {
            if (!key) return;
            onChange(key.toString() as FLSaisonPhase);
          }}
          className="w-full sm:max-w-sm">
          <FieldLabel path="saison_phase">Phase</FieldLabel>
          <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
            {/* From the prop, not `Select.Value` — the collection can lag a render behind and would
                show HeroUI's English placeholder. Same reasoning as `ClosedSetSelect`'s trigger. */}
            <span className={phase ? "" : "text-foreground-muted"}>{phase === null ? "Phase wählen" : PHASE_LABELS[phase]}</span>
            <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
          </Select.Trigger>
          <FieldError className={FIELD_ERROR} />
          <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
            <ListBox aria-label="Phasen">
              {phaseOffer.map(({ phase: option, expected, fits }) => (
                <ListBox.Item
                  key={option}
                  id={option}
                  textValue={PHASE_LABELS[option]}
                  isDisabled={!fits}
                  className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200 data-disabled:cursor-not-allowed data-disabled:opacity-40">
                  {PHASE_LABELS[option]}
                  {/* The expected count, always: it answers "why is that one disabled" and "how many
                      matches does this phase hold" in the same two characters. */}
                  <span className="fluid-xs text-foreground-muted font-semibold">{expected} Sp.</span>
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Select
          isRequired
          name="position"
          aria-label="Position"
          value={String(position)}
          onChange={(key: Key | null) => {
            if (!key) return;
            onPositionChange(Number(key));
          }}
          className="w-full sm:max-w-sm">
          <FieldLabel path="position">Position</FieldLabel>
          <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
            {/* From the prop for `Select.Value`'s reason above. */}
            <span>{position}.</span>
            <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
          </Select.Trigger>
          <FieldError className={FIELD_ERROR} />
          <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
            <ListBox aria-label="Positionen">
              {positionOffer.map(({ position: option, isTaken }) => (
                <ListBox.Item
                  key={option}
                  id={String(option)}
                  textValue={`${String(option)}.`}
                  isDisabled={isTaken}
                  className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200 data-disabled:cursor-not-allowed data-disabled:opacity-40">
                  <span>{option}.</span>
                  {/* Says WHY the row is greyed out, which "disabled" alone never does. */}
                  {isTaken && <span className="fluid-xs text-foreground-muted font-semibold">belegt</span>}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
    </section>
  );
}
