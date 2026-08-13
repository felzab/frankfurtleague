"use client";

import { FieldError, NumberField } from "@heroui/react";

import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import { SpielortFieldLabel } from "./SpielortFieldLabel";

import type { SpielortBanner } from "./banners";

/**
 * What the venue costs by default.
 *
 * **It is a default and never a stored copy** (ADR-0021 rule 2). What a match cost is `mietpreis` on
 * that match, agreed when it was scheduled; this number seeds the next one and rewrites none of them.
 * The backend's fan-out deliberately excludes it, so the Hinweis below is a statement about the write
 * path rather than a hope.
 *
 * 0 € is legitimate — a school hall the league is lent — so the field is required rather than
 * nullable, and the value is judged on change: a stepper is a picker, and there is no half-entered
 * state to be wrong about.
 */
export function FormMieteSection({
  defaultMietpreis,
  onChange,
  onFieldChanged,
  banners,
}: {
  defaultMietpreis: number;
  onChange: (next: number) => void;
  onFieldChanged: (paths: readonly string[], picked: { default_mietpreis: number }) => void;
  /** The editor's whole Hinweis list; the spot below takes its own entry out of it. */
  banners: readonly SpielortBanner[];
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Miete
          <InfoHint label="Hinweis zur Miete">
            <p>Der Standardsatz für neue Ansetzungen.</p>
            <ul>
              <li>
                Bereits angesetzte Spiele <strong>behalten ihre vereinbarte Miete</strong>.
              </li>
              <li>0 € ist eine gültige Angabe, etwa für eine Halle, die der Liga überlassen wird.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        <InlineBanners
          banners={banners}
          spot="miete"
        />

        <NumberField
          isRequired
          minValue={0}
          step={5}
          name="default_mietpreis"
          value={defaultMietpreis}
          onChange={(next) => {
            // `NaN` is what an emptied stepper reports; 0 € is the meaningful floor and the schema's.
            const value = next === undefined || isNaN(next) ? 0 : next;
            onChange(value);
            onFieldChanged(["default_mietpreis"], { default_mietpreis: value });
          }}
          formatOptions={{ style: "currency", currency: "EUR" }}
          className="w-full sm:max-w-xs">
          <SpielortFieldLabel path="default_mietpreis">Standard-Mietpreis</SpielortFieldLabel>
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
