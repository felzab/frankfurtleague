"use client";

import { parseDate } from "@internationalized/date";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { Callout } from "@/shared/components/ui/Callout";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import { SaisonFieldLabel } from "./SaisonFieldLabel";

import type { CalendarDate } from "@internationalized/date";

/**
 * When the season runs.
 *
 * **The season contains its matchdays, and both directions are enforced** (decided 2026-08-08): a matchday
 * cannot reach outside the season (`REQ-DATE-002`), and the season cannot shrink under a live matchday
 * (`REQ-DATE-004`) — which is what `spieltagBound` greys out in the pickers below, so the illegal day is
 * unpickable rather than a 409. What the dates deliberately do NOT constrain is a match: a fixture is
 * held to its MATCHDAY's span (`REQ-DATE-001`), never to the season directly, and the rollover stays a
 * deliberate act rather than something the end date triggers.
 */
export function FormZeitraumSection({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onFieldLeft,
  isEndBeforeStart,
  spieltagBound,
}: {
  startDate: CalendarDate | null;
  onStartDateChange: (next: CalendarDate | null) => void;
  endDate: CalendarDate | null;
  onEndDateChange: (next: CalendarDate | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /** Whether the drafted end date falls before the drafted start date. */
  isEndBeforeStart: boolean;
  /**
   * The span the live matchdays already occupy (`REQ-DATE-004`): the start picker closes past
   * `startMax`, the end picker before `endMin`. Absent while the season has no live matchday, which
   * leaves both pickers unbounded — a fresh season has nothing to sit above.
   */
  spieltagBound?: { startMax: string; endMin: string };
}) {
  const panel = formPanel();

  // Parsed once for both pickers, `undefined` where no matchday binds — the same shape the matchday
  // form gives its season span.
  const startMax = spieltagBound ? parseDate(spieltagBound.startMax) : undefined;
  const endMin = spieltagBound ? parseDate(spieltagBound.endMin) : undefined;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Zeitraum
          <InfoHint label="Hinweis zum Zeitraum">
            <p>Der Zeitraum umschließt die Spieltage der Saison.</p>
            <ul>
              <li>
                Alle <strong>Spieltage</strong> müssen im Zeitraum liegen — Tage, die einen Spieltag ausschließen würden, sind im Kalender
                gesperrt.
              </li>
              <li>
                Ein <strong>Spiel</strong> richtet sich nach seinem Spieltag, nicht direkt nach der Saison.
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
            maxValue={startMax}
          />
          <SaisonDateField
            isRequired
            name="end_date"
            ariaLabel="Ende auswählen"
            label={<SaisonFieldLabel path="end_date">Ende</SaisonFieldLabel>}
            value={endDate}
            onChange={onEndDateChange}
            onBlur={() => onFieldLeft(["end_date"])}
            minValue={endMin}
          />
        </div>

        {/* The same rule the payload schema and the model validator both hold (decided 2026-08-08), said
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
