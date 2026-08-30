"use client";

import { FieldError, NumberField } from "@heroui/react";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { enteredNumber } from "@/shared/utils/numberField";

/**
 * A default and never a stored copy: what a match pays is its own `payment`, and the backend's
 * fan-out excludes this. 0 € is legitimate, so the field is required rather than nullable and is
 * judged on change — a stepper has no half-entered state.
 */
export function FormHonorarSection({
  defaultPayment,
  onChange,
  onFieldChanged,
}: {
  defaultPayment: number | null;
  onChange: (next: number | null) => void;
  onFieldChanged: (paths: readonly string[], picked: { default_payment: number | null }) => void;
}) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Honorar
          <Hint
            mode="reveal"
            label="Hinweis zum Honorar"
            body={{ lead: "Der Standardsatz für neue Ansetzungen." }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        <NumberField
          isRequired
          minValue={0}
          step={5}
          name="default_payment"
          value={defaultPayment ?? Number.NaN}
          onChange={(next) => {
            // An emptied box is "no standard fee entered", never 0 €: the schema's type check is what
            // then asks for one, in its own German, at the submit.
            const value = enteredNumber(next);
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
