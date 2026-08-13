"use client";

import { parseDate } from "@internationalized/date";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SpieltagFieldLabel } from "./SpieltagFieldLabel";

import type { SpieltagBanner } from "./banners";

/**
 * When the matchday is played — and, within its phase, where it sits, because the order is `beginn`
 * (ADR-0051). Moving a matchday is editing this pair.
 *
 * **The date control is the season slice's**, imported rather than rewritten: a matchday's
 * `beginn`/`ende` pair and a season's `start_date`/`end_date` pair are the same control doing the
 * same job, and writing a second picker is how two date fields in one admin acquire two different
 * popovers. The cross-feature import is legal — that lint is scoped to `core` and `shared`
 * (ADR-0008).
 *
 * **Both pickers are bounded by the season's own span** (`REQ-DATE-002`), so a day the endpoint would
 * refuse is greyed out rather than reported afterwards. The other span rule cannot be bounded here:
 * `REQ-DATE-003` refuses a span that no longer covers this matchday's own fixtures, and the fixtures
 * are not on this page — the rail states it instead.
 */
export function FormZeitraumSection({
  beginn,
  ende,
  onBeginnChange,
  onEndeChange,
  saisonSpan,
  banners,
}: {
  beginn: string;
  ende: string;
  onBeginnChange: (next: string) => void;
  onEndeChange: (next: string) => void;
  /** The season's own `start_date`/`end_date`, which bound both pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  /** The editor's whole Hinweis list; the spot below takes its own entries out of it. */
  banners: readonly SpieltagBanner[];
}) {
  const panel = formPanel();

  /** The draft holds the payload's own strings and the picker wants a `CalendarDate` — see the season form. */
  const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

  // Parsed once for both pickers. `undefined` where the caller passed no span, which leaves the
  // calendar unbounded rather than bounded to nothing.
  const spanStart = saisonSpan ? parseDate(saisonSpan.start) : undefined;
  const spanEnd = saisonSpan ? parseDate(saisonSpan.end) : undefined;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Zeitraum
          <InfoHint label="Hinweis zum Zeitraum">
            <p>Wann der Spieltag gespielt wird.</p>
            <ul>
              <li>
                Innerhalb einer Phase wird <strong>nach Beginn sortiert</strong> — verschieben heißt also: Datum ändern.
              </li>
              <li>Der Zeitraum muss innerhalb der Saison liegen; alles andere ist im Kalender ausgegraut.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="zeitraum"
        />

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <SaisonDateField
            isRequired
            name="beginn"
            minValue={spanStart}
            maxValue={spanEnd}
            ariaLabel="Beginn auswählen"
            label={<SpieltagFieldLabel path="beginn">Beginn</SpieltagFieldLabel>}
            value={asCalendarDate(beginn)}
            onChange={(next) => onBeginnChange(next?.toString() ?? "")}
          />
          <SaisonDateField
            isRequired
            name="ende"
            minValue={spanStart}
            maxValue={spanEnd}
            ariaLabel="Ende auswählen"
            label={<SpieltagFieldLabel path="ende">Ende</SpieltagFieldLabel>}
            value={asCalendarDate(ende)}
            onChange={(next) => onEndeChange(next?.toString() ?? "")}
          />
        </div>
      </div>
    </section>
  );
}
