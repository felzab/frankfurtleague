"use client";

import { FieldError, NumberField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { enteredNumber } from "@/shared/utils/numberField";

/**
 * A default and never a stored copy: what a match cost is its own `mietpreis`, and the backend's
 * fan-out excludes this. 0 € is legitimate, so the field is required rather than nullable and is
 * judged on change — a stepper has no half-entered state.
 */
export function FormMieteSection({
  defaultMietpreis,
  onChange,
  onFieldChanged,
}: {
  defaultMietpreis: number | null;
  onChange: (next: number | null) => void;
  onFieldChanged: (paths: readonly string[], picked: { default_mietpreis: number | null }) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Miete">
          <Hint
            mode="reveal"
            label="Hinweis zur Miete"
            body={{ lead: "Diese Miete gilt für neue Spiele." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <NumberField
          isRequired
          minValue={0}
          step={5}
          name="default_mietpreis"
          value={defaultMietpreis ?? Number.NaN}
          onChange={(next) => {
            // An emptied box is "no standard rent entered", never 0 €: the schema's type check is what
            // then asks for one, in its own German, at the submit.
            const value = enteredNumber(next);
            onChange(value);
            onFieldChanged(["default_mietpreis"], { default_mietpreis: value });
          }}
          formatOptions={{ style: "currency", currency: "EUR" }}
          className="w-full sm:max-w-xs">
          <FieldLabel path="default_mietpreis">Standard-Mietpreis</FieldLabel>
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
