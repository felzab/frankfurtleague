"use client";

import { parseDate } from "@internationalized/date";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { SpieltagBanner } from "./banners";

/**
 * **Every picker is bounded by the season's span** (`REQ-DATE-002`), so a day outside the season is
 * greyed out. `REQ-DATE-003` and `REQ-DATE-008` grey out nothing: a greyed day states neither the
 * rows they read nor the escape each turns on.
 */
export function FormZeitraumSection({
  beginn,
  ende,
  isSingleDay,
  onBeginnChange,
  onEndeChange,
  saisonSpan,
  banners,
}: {
  beginn: string;
  ende: string;
  /**
   * One date instead of a pair, the caller deciding which matchdays are played inside a single day.
   * `onBeginnChange` is what it reports to, and the caller carries the day over to `ende` itself.
   */
  isSingleDay: boolean;
  onBeginnChange: (next: string) => void;
  onEndeChange: (next: string) => void;
  /** The season's own `start_date`/`end_date`, which bound every picker (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  banners: readonly SpieltagBanner[];
}) {
  const panel = formPanel();

  /**
   * The draft holds the payload's own strings and the picker wants a `CalendarDate` — see the season
   * form. Empty is the undated matchday as much as the cleared field, and both open the calendar bare.
   */
  const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

  // Parsed once for every picker. `undefined` where no span was passed, which leaves the calendar
  // unbounded rather than bounded to nothing.
  const spanStart = saisonSpan ? parseDate(saisonSpan.start) : undefined;
  const spanEnd = saisonSpan ? parseDate(saisonSpan.end) : undefined;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Zeitraum
          <Hint
            mode="reveal"
            label="Hinweis zum Zeitraum"
            body={{
              lead: "Wann der Spieltag gespielt wird.",
              points: [
                { term: "Die Reihenfolge", text: "steht mit dem Spielplan fest." },
                { term: "Tage außerhalb der Saison", text: "sind im Kalender ausgegraut." },
              ],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="zeitraum"
        />

        <div className={FIELD_PAIR}>
          {isSingleDay ? (
            // The Datum label sits on the `beginn` path because `REQ-DATE-002` is the only refusal
            // this save can put on a field, and one picker leaves one place for it to land.
            <SaisonDateField
              isRequired
              name="beginn"
              minValue={spanStart}
              maxValue={spanEnd}
              rangeMessage="Wähle einen Tag innerhalb der Saison."
              ariaLabel="Datum auswählen"
              label={<FieldLabel path="beginn">Datum</FieldLabel>}
              value={asCalendarDate(beginn)}
              onChange={(next) => onBeginnChange(next?.toString() ?? "")}
            />
          ) : (
            <>
              <SaisonDateField
                isRequired
                name="beginn"
                minValue={spanStart}
                maxValue={spanEnd}
                rangeMessage="Wähle einen Tag innerhalb der Saison."
                ariaLabel="Beginn auswählen"
                label={<FieldLabel path="beginn">Beginn</FieldLabel>}
                value={asCalendarDate(beginn)}
                onChange={(next) => onBeginnChange(next?.toString() ?? "")}
              />
              <SaisonDateField
                isRequired
                name="ende"
                minValue={spanStart}
                maxValue={spanEnd}
                rangeMessage="Wähle einen Tag innerhalb der Saison."
                ariaLabel="Ende auswählen"
                label={<FieldLabel path="ende">Ende</FieldLabel>}
                value={asCalendarDate(ende)}
                onChange={(next) => onEndeChange(next?.toString() ?? "")}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
