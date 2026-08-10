import { FieldError, NumberField } from "@heroui/react";

import { AdminCreateSchiedsrichterForm } from "@/features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { FormModal } from "@/shared/components/ui/FormModal";

import { FieldLabel } from "./FieldLabel";
import { PickOrCreateAutocomplete } from "./PickOrCreateAutocomplete";
import { StepFiveButton } from "./StepFiveButton";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielSchiedsrichterFieldDraft } from "@/features/spiele/schemas";

/** Who referees, and what they are paid. Same 2fr/1fr split as the venue, for the same reason. */
export function FormSchiedsrichterSection({
  schiedsrichter,
  schiedsrichterPayload,
  onSchiedsrichterChange,
  onValidateFields,
}: {
  schiedsrichter: FLSchiedsrichter[];
  schiedsrichterPayload: FLSpielSchiedsrichterFieldDraft | null;
  onSchiedsrichterChange: (payload: FLSpielSchiedsrichterFieldDraft | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  // The picker hands over the resolved record — see the note on `FormSpielortSection`.
  const handleSchiedsrichterChange = (resolved: FLSchiedsrichter | null) => {
    onSchiedsrichterChange(
      resolved
        ? {
            schiedsrichter_id: resolved.id,
            name: resolved.name,
            payment: resolved.default_payment,
          }
        : null,
    );
  };

  // An emptied currency field arrives as NaN and must stay empty: coerced to 0, a
  // cleared Honorar submits as 0 € and reads as a referee working for free. The
  // `?? NaN` below is the other half -- RAC types `value?: number`.
  const handlePaymentChange = (newPayment: number) => {
    if (schiedsrichterPayload) {
      onSchiedsrichterChange({
        ...schiedsrichterPayload,
        payment: isNaN(newPayment) ? null : Math.round(newPayment),
      });
    }
  };

  // The ±5 buttons' own arithmetic — see the Mietpreis twin.
  const stepPayment = (delta: number) => {
    if (schiedsrichterPayload) {
      onSchiedsrichterChange({ ...schiedsrichterPayload, payment: Math.max(0, (schiedsrichterPayload.payment ?? 0) + delta) });
    }
  };

  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <PickOrCreateAutocomplete<FLSchiedsrichter>
        label="Schiedsrichter"
        fieldPath="schiedsrichter.schiedsrichter_id"
        placeholder="z.B. Pierluigi Collina"
        items={schiedsrichter}
        selectedId={schiedsrichterPayload?.schiedsrichter_id ?? null}
        onSelect={handleSchiedsrichterChange}
        createLabel="Neuen Schiedsrichter anlegen"
        emptyStateText="Dieser Schiedsrichter existiert noch nicht."
        renderCreateModal={({ isOpen, onClose, onCreated }) => (
          <FormModal
            isOpen={isOpen}
            onClose={onClose}
            heading="Schiedsrichter anlegen">
            <AdminCreateSchiedsrichterForm
              onClose={onClose}
              onCreated={onCreated}
            />
          </FormModal>
        )}
      />

      <NumberField
        minValue={0}
        name="schiedsrichter.payment"
        value={schiedsrichterPayload?.payment ?? NaN}
        onChange={handlePaymentChange}
        // On blur — see the note on the Mietpreis field, which is the same box with the same NaN window.
        onBlur={() => onValidateFields(["schiedsrichter.payment"])}
        onKeyDown={suppressEnterSubmit}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <FieldLabel path="schiedsrichter.payment">Entschädigung</FieldLabel>
        <NumberField.Group className={FIELD_GROUP}>
          <StepFiveButton
            direction="decrement"
            isDisabled={!schiedsrichterPayload}
            onStep={() => stepPayment(-5)}
          />
          <NumberField.Input className={FIELD_COUNT_INPUT} />
          <StepFiveButton
            direction="increment"
            isDisabled={!schiedsrichterPayload}
            onStep={() => stepPayment(5)}
          />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR} />
      </NumberField>
    </div>
  );
}
