import { FieldError, NumberField } from "@heroui/react";

import { AdminCreateSchiedsrichterForm } from "@/features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { FormModal } from "@/shared/components/ui/FormModal";

import { FieldLabel } from "./FieldLabel";
import { PickOrCreateAutocomplete } from "./PickOrCreateAutocomplete";
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

  // An emptied currency field arrives as NaN and must stay empty. Coercing it to 0 here is what let
  // a cleared Honorar submit as 0 € without a word — indistinguishable
  // from a referee who genuinely works for free. `null` fails the payload schema instead, which is
  // the honest outcome. The `?? NaN` at the display boundary below is the other half and must stay:
  // RAC types `value?: number`, so `value={null}` is a type error.
  const handlePaymentChange = (newPayment: number) => {
    if (schiedsrichterPayload) {
      onSchiedsrichterChange({
        ...schiedsrichterPayload,
        payment: isNaN(newPayment) ? null : newPayment,
      });
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

      {/** Schiedsrichter Entschädigung */}
      <NumberField
        minValue={0}
        name="schiedsrichter.payment"
        value={schiedsrichterPayload?.payment ?? NaN}
        onChange={handlePaymentChange}
        // On blur — see the note on the Mietpreis field, which is the same box with the same NaN window.
        onBlur={() => onValidateFields(["schiedsrichter.payment"])}
        onKeyDown={suppressEnterSubmit}
        step={5}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <FieldLabel path="schiedsrichter.payment">Entschädigung</FieldLabel>
        <NumberField.Group className={FIELD_GROUP}>
          <NumberField.DecrementButton />
          <NumberField.Input className={FIELD_COUNT_INPUT} />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR} />
      </NumberField>
    </div>
  );
}
