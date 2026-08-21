"use client";

import { parseDate } from "@internationalized/date";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { SpieltagBanner } from "./banners";

/**
 * **Both pickers are bounded by the season's span** (`REQ-DATE-002`), so a day outside the season is
 * greyed out. `REQ-DATE-003` and `REQ-DATE-008` grey out nothing: a greyed day states neither the
 * rows they read nor the escape each turns on.
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
  banners: readonly SpieltagBanner[];
}) {
  const panel = formPanel();

  /**
   * The draft holds the payload's own strings and the picker wants a `CalendarDate` — see the season
   * form. Empty is the undated matchday as much as the cleared field, and both open the calendar bare.
   */
  const asCalendarDate = (value: string) => (value === "" ? null : parseDate(value));

  // Parsed once for both pickers. `undefined` where no span was passed, which leaves the calendar
  // unbounded rather than bounded to nothing.
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
                Der Zeitraum <strong>ändert die Reihenfolge nicht</strong>. Sie steht mit dem Spielplan fest.
              </li>
              <li>
                Der <strong>Beginn</strong> folgt dieser Reihenfolge. Er darf nicht vor dem Beginn eines Spieltags liegen, der in seiner Phase
                davor steht. Er darf auch nicht nach dem Beginn eines Spieltags liegen, der danach steht. Es zählen nur Spieltage, die schon
                einen Zeitraum haben.
              </li>
              <li>
                Das <strong>Ende</strong> ist daran nicht gebunden und darf weiter reichen. Soll ein Spieltag später gespielt werden, verlege
                seine Spiele in die späteren Tage seines Zeitraums.
              </li>
              <li>Der Zeitraum muss innerhalb der Saison liegen. Tage außerhalb der Saison sind im Kalender ausgegraut.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="zeitraum"
        />

        <div className={FIELD_PAIR}>
          <SaisonDateField
            isRequired
            name="beginn"
            minValue={spanStart}
            maxValue={spanEnd}
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
            ariaLabel="Ende auswählen"
            label={<FieldLabel path="ende">Ende</FieldLabel>}
            value={asCalendarDate(ende)}
            onChange={(next) => onEndeChange(next?.toString() ?? "")}
          />
        </div>
      </div>
    </section>
  );
}
