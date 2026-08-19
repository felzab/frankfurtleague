"use client";

import { FieldError, ListBox, Select } from "@heroui/react";

import { PHASE_LABELS } from "@/features/saisons/constants";
import { FIELD_ERROR, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import { SpieltagFieldLabel } from "./SpieltagFieldLabel";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { SpieltagPhaseOffer } from "@/features/spieltage/utils";
import type { Key } from "@heroui/react";
import type { SpieltagBanner } from "./banners";

/**
 * **A phase accounting for fewer matches than this matchday holds is offered and disabled, never
 * hidden**: `GruppeSelect`'s treatment for a full group, so an admin sees why rather than wondering
 * where it went.
 */
export function FormPhaseSection({
  phase,
  onChange,
  phaseOffer,
  banners,
}: {
  phase: FLSaisonPhase | null;
  onChange: (next: FLSaisonPhase) => void;
  /** Every phase with this season's expected match count, and whether the attached fixtures still fit. */
  phaseOffer: readonly SpieltagPhaseOffer[];
  banners: readonly SpieltagBanner[];
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Phase
          <InfoHint label="Hinweis zur Phase">
            <p>Die Runde, zu der dieser Spieltag gehört.</p>
            <ul>
              <li>
                Sie entscheidet auch über <strong>Name und Position</strong>. Beides ist abgeleitet und kein eigenes Feld.
              </li>
              <li>Wie viele Spiele die Phase umfasst, folgt aus den Regeln der Saison.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
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
          <SpieltagFieldLabel path="saison_phase">Phase</SpieltagFieldLabel>
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
      </div>
    </section>
  );
}
