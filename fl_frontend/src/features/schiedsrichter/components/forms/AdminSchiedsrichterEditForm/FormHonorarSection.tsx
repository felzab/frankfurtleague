"use client";

import { FieldError } from "@heroui/react/field-error";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT_CLASSES, FIELD_ERROR_CLASSES, FIELD_GROUP_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { NumberField } from "@/shared/components/ui/NumberField";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { SchiedsrichterFieldPath } from "@/features/schiedsrichter/schiedsrichterDraftStatus";

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
        <PanelHeading
          className={panel.heading()}
          title="Honorar">
          <Hint
            mode="reveal"
            label="Hinweis zum Honorar"
            body={{ lead: "Der Standardsatz für neue Ansetzungen." }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <NumberField
          isRequired
          minValue={0}
          step={5}
          name="default_payment"
          value={defaultPayment}
          onChange={(value) => {
            // An emptied box is "no standard fee entered", never 0 €: the schema's type check is what
            // then asks for one, in its own German, at the submit.
            onChange(value);
            onFieldChanged(["default_payment"], { default_payment: value });
          }}
          formatOptions={{ style: "currency", currency: "EUR" }}
          className="w-full sm:max-w-xs">
          <FieldLabel<SchiedsrichterFieldPath> path="default_payment">Standard-Honorar</FieldLabel>
          <NumberField.Group className={FIELD_GROUP_CLASSES}>
            <NumberField.DecrementButton />
            <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
            <NumberField.IncrementButton />
          </NumberField.Group>
          <FieldError className={FIELD_ERROR_CLASSES} />
        </NumberField>
      </div>
    </section>
  );
}
