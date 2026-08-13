"use client";

import { FieldError, NumberField } from "@heroui/react";

import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SchiedsrichterFieldLabel } from "./SchiedsrichterFieldLabel";

import type { SchiedsrichterBanner } from "./banners";

/**
 * What the referee is paid by default.
 *
 * **It is a default and never a stored copy** (ADR-0021 rule 2). What a match pays is `payment` on
 * that match, agreed when it was scheduled; this number seeds the next one and rewrites none of them.
 * The backend's fan-out deliberately excludes it, so the Hinweis below is a statement about the write
 * path rather than a hope.
 *
 * 0 € is legitimate — a volunteer — so the field is required rather than nullable, and the value is
 * judged on change: a stepper is a picker, and there is no half-entered state to be wrong about.
 */
export function FormHonorarSection({
  defaultPayment,
  onChange,
  onFieldChanged,
  banners,
}: {
  defaultPayment: number;
  onChange: (next: number) => void;
  onFieldChanged: (paths: readonly string[], picked: { default_payment: number }) => void;
  /** The editor's whole Hinweis list; the spot below takes its own entry out of it. */
  banners: readonly SchiedsrichterBanner[];
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Honorar
          <InfoHint label="Hinweis zum Honorar">
            <p>Der Standardsatz für neue Ansetzungen.</p>
            <ul>
              <li>
                Bereits angesetzte Spiele <strong>behalten ihr vereinbartes Honorar</strong>.
              </li>
              <li>0 € ist eine gültige Angabe, etwa für einen ehrenamtlichen Einsatz.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="honorar"
        />

        <NumberField
          isRequired
          minValue={0}
          step={5}
          name="default_payment"
          value={defaultPayment}
          onChange={(next) => {
            // `NaN` is what an emptied stepper reports; 0 € is the meaningful floor and the schema's.
            const value = next === undefined || isNaN(next) ? 0 : next;
            onChange(value);
            onFieldChanged(["default_payment"], { default_payment: value });
          }}
          formatOptions={{ style: "currency", currency: "EUR" }}
          className="w-full sm:max-w-xs">
          <SchiedsrichterFieldLabel path="default_payment">Standard-Honorar</SchiedsrichterFieldLabel>
          <NumberField.Group className={FIELD_GROUP}>
            <NumberField.DecrementButton />
            <NumberField.Input className={FIELD_COUNT_INPUT} />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <FieldError className={FIELD_ERROR} />
        </NumberField>
      </div>
    </section>
  );
}
