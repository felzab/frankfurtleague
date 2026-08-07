"use client";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { Callout } from "@/shared/components/ui/Callout";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { SaisonFieldLabel } from "./SaisonFieldLabel";

import type { CalendarDate } from "@internationalized/date";

/**
 * When the season runs.
 *
 * **Nothing in the app holds these two dates against anything.** A match's own `datum` is not required to
 * fall inside them, a matchday's `beginn` is not either, and the rollover is a deliberate act rather than
 * something the end date triggers — so this pair describes the season rather than constraining it, and the
 * callout below says what it is instead of implying a guard exists.
 */
export function FormZeitraumSection({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onFieldLeft,
  isEndBeforeStart,
}: {
  startDate: CalendarDate | null;
  onStartDateChange: (next: CalendarDate | null) => void;
  endDate: CalendarDate | null;
  onEndDateChange: (next: CalendarDate | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Whether the drafted end date falls before the drafted start date. */
  isEndBeforeStart: boolean;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Zeitraum
          <InfoHint label="Hinweis zum Zeitraum">
            <p>Der Zeitraum beschreibt die Saison, er begrenzt sie nicht.</p>
            <ul>
              <li>
                Ein Spiel darf <strong>außerhalb</strong> liegen, ohne dass etwas widerspricht.
              </li>
              <li>
                Die Umstellung auf eine neue Saison passiert <strong>von Hand</strong>, nicht am Enddatum.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <SaisonDateField
            isRequired
            name="start_date"
            ariaLabel="Beginn auswählen"
            label={<SaisonFieldLabel path="start_date">Beginn</SaisonFieldLabel>}
            value={startDate}
            onChange={onStartDateChange}
            onBlur={() => onFieldLeft(["start_date"])}
          />
          <SaisonDateField
            isRequired
            name="end_date"
            ariaLabel="Ende auswählen"
            label={<SaisonFieldLabel path="end_date">Ende</SaisonFieldLabel>}
            value={endDate}
            onChange={onEndDateChange}
            onBlur={() => onFieldLeft(["end_date"])}
          />
        </div>

        {/* The same rule the payload schema and the model validator both hold (owner, 2026-08-08), said
            here as well because the save bar is the other end of the page: a person editing the Ende
            should read why it will be refused beside the field, not only when they press save. */}
        {isEndBeforeStart && (
          <Callout
            severity="danger"
            title="Das Ende liegt vor dem Beginn">
            So lässt sich die Saison nicht speichern. Meistens ist es ein Zahlendreher im Jahr.
          </Callout>
        )}
      </div>
    </section>
  );
}
