"use client";

import { parseDate } from "@internationalized/date";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { CalendarDate } from "@internationalized/date";
import type { SaisonBanner } from "./banners";

/**
 * **The season contains its matchdays, both directions enforced**: `REQ-DATE-002` outward and
 * `REQ-DATE-004` inward, which `spieltagBound` greys out below. A fixture is held to its MATCHDAY's
 * span (`REQ-DATE-001`) and never to the season.
 */
export function FormZeitraumSection({
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  onFieldLeft,
  spieltagBound,
  banners,
}: {
  startDate: CalendarDate | null;
  onStartDateChange: (next: CalendarDate | null) => void;
  endDate: CalendarDate | null;
  onEndDateChange: (next: CalendarDate | null) => void;
  onFieldLeft: (paths: readonly string[]) => void;
  /**
   * The span the live matchdays occupy (`REQ-DATE-004`). Absent while the season has no live matchday,
   * which leaves both pickers unbounded.
   */
  spieltagBound?: { startMax: string; endMin: string };
  banners: readonly SaisonBanner[];
}) {
  const panel = formPanel();

  // Parsed once for both pickers, `undefined` where no matchday binds.
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
                Alle <strong>Spieltage</strong> müssen im Zeitraum liegen. Tage, die einen Spieltag ausschließen würden, sind im Kalender
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
        <div className={FIELD_PAIR}>
          <SaisonDateField
            isRequired
            name="start_date"
            ariaLabel="Beginn auswählen"
            label={<FieldLabel path="start_date">Beginn</FieldLabel>}
            value={startDate}
            onChange={onStartDateChange}
            onBlur={() => onFieldLeft(["start_date"])}
            maxValue={startMax}
          />
          <SaisonDateField
            isRequired
            name="end_date"
            ariaLabel="Ende auswählen"
            label={<FieldLabel path="end_date">Ende</FieldLabel>}
            value={endDate}
            onChange={onEndDateChange}
            onBlur={() => onFieldLeft(["end_date"])}
            minValue={endMin}
          />
        </div>

        {/* The same rule the payload schema and the model validator both hold, said here as well
            because the save bar is the other end of the page: a person editing the Ende should read
            why it will be refused beside the field. */}
        <InlineBanners
          banners={banners}
          spot="zeitraum"
        />
      </div>
    </section>
  );
}
