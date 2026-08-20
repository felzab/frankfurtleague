"use client";

import { FieldError, NumberField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { SchiedsrichterBanner } from "./banners";

/**
 * A default and never a stored copy: what a match pays is its own `payment`, and the backend's
 * fan-out excludes this. 0 € is legitimate, so the field is required rather than nullable and is
 * judged on change — a stepper has no half-entered state.
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
          <FieldLabel path="default_payment">Standard-Honorar</FieldLabel>
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
