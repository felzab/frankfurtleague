"use client";

import { FieldError } from "@heroui/react/field-error";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT_CLASSES, FIELD_ERROR_CLASSES, FIELD_GROUP_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { NumberField } from "@/shared/components/ui/NumberField";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { SpielortFieldPath } from "@/features/spielorte/spielortDraftStatus";

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
          value={defaultMietpreis}
          onChange={(value) => {
            // An emptied box is "no standard rent entered", never 0 €: the schema's type check is what
            // then asks for one, in its own German, at the submit.
            onChange(value);
            onFieldChanged(["default_mietpreis"], { default_mietpreis: value });
          }}
          formatOptions={{ style: "currency", currency: "EUR" }}
          className="w-full sm:max-w-xs">
          <FieldLabel<SpielortFieldPath> path="default_mietpreis">Standard-Mietpreis</FieldLabel>
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
