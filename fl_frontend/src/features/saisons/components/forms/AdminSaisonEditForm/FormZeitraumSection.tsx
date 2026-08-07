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
 * fall inside them, matchdays are ordered by `order_val` rather than by date, and the rollover is a
 * deliberate act rather than something the end date triggers — so this pair describes the season rather
 * than constraining it, and the callout below says what it is instead of implying a guard exists.
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

        {/* Not a refusal, and it deliberately does not block the save: no schema and no endpoint holds
            the two dates in order, so a page refusing here would enforce a rule the API does not have.
            Naming it is the honest amount of help. */}
        {isEndBeforeStart && (
          <Callout
            severity="warning"
            title="Das Ende liegt vor dem Beginn">
            Gespeichert wird das trotzdem, weil nichts diese Reihenfolge verlangt. Meistens ist es ein Zahlendreher im Jahr.
          </Callout>
        )}
      </div>
    </section>
  );
}
