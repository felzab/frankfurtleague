"use client";

import { parseDate } from "@internationalized/date";

import { SaisonDateField } from "@/features/saisons/components/forms/SaisonFormControls";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_PAIR } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { SaisonSpieltagBound } from "@/features/saisons/types";
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
   * The span the DATED matchdays occupy (`REQ-DATE-004`). `null` at an end leaves that picker
   * unbounded, which is the answer for a season with no matchday and for one whose matchdays are all
   * still undated.
   */
  spieltagBound: SaisonSpieltagBound;
  banners: readonly SaisonBanner[];
}) {
  const panel = formPanel();

  // Parsed per end and never on a stand-in string: `parseDate` THROWS on one it cannot read, so an
  // unbound end has to be `undefined` here rather than a value that happens to parse.
  const startMax = spieltagBound.startMax === null ? undefined : parseDate(spieltagBound.startMax);
  const endMin = spieltagBound.endMin === null ? undefined : parseDate(spieltagBound.endMin);

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Zeitraum
          <Hint
            mode="reveal"
            label="Hinweis zum Zeitraum"
            body={{
              lead: "Der Zeitraum umschließt die Spieltage der Saison.",
              points: [
                { term: "Ein Spiel", text: "richtet sich nach seinem Spieltag, nicht nach der Saison." },
                { term: "Auf eine neue Saison", text: "stellst Du von Hand um." },
              ],
            }}
          />
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
            rangeMessage="Wähle einen Tag vor dem Ende."
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
            rangeMessage="Wähle einen Tag nach dem Beginn."
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
