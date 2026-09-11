import { FieldError, NumberField } from "@heroui/react";

import { AdminCreateSchiedsrichterForm } from "@/features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm";
import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL, schiedsrichterAnzeigename } from "@/features/schiedsrichter/constants";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { FormModal } from "@/shared/components/ui/FormModal";
import { enteredNumber } from "@/shared/utils/numberField";

import { ExpectedMarker } from "./ExpectedMarker";
import { PickOrCreateAutocomplete } from "./PickOrCreateAutocomplete";
import { StepFiveButton } from "./StepFiveButton";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSchiedsrichterAngezeigt } from "@/features/schiedsrichter/types";
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
  // The LIST's word for a nameless row rather than the erasure's, this read serving no stamped row
  // (`docs/backend/spec.md :: I227`). Nothing written comes from here:
  // `fl_frontend/src/features/spiele/schemas.ts :: FLSpielSchiedsrichterFieldPayloadSchema` carries
  // the id and the fee alone.
  const offered: FLSchiedsrichterAngezeigt[] = schiedsrichter.map((candidate) => ({
    ...candidate,
    name: candidate.name ?? SCHIEDSRICHTER_OHNE_NAMEN_LABEL,
  }));

  // The referee this fixture ALREADY holds, where the list offers nobody: the default read drops every
  // retired row, and the erasure retires the person it erases. Without this the trigger renders blank
  // on a fixture that HAS a referee.
  const held: FLSchiedsrichterAngezeigt[] =
    schiedsrichterPayload === null || offered.some((candidate) => candidate.id === schiedsrichterPayload.schiedsrichter_id)
      ? []
      : [
          {
            id: schiedsrichterPayload.schiedsrichter_id,
            name: schiedsrichterAnzeigename(schiedsrichterPayload.name),
            // The fixture's own agreed fee, never a default this list has no row to read one from:
            // re-picking the held referee must not silently reprice the fixture.
            default_payment: schiedsrichterPayload.payment ?? 0,
            schule: null,
            kontakt: { email: null, telefon: null },
            inactive_since: null,
            anonymisiert_am: null,
          },
        ];

  // The resolved record, as in `FormSpielortSection`: `name` arrives already parsed.
  const handleSchiedsrichterChange = (resolved: FLSchiedsrichterAngezeigt | null) => {
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

  // An emptied field arrives as NaN and must stay empty: coerced to 0, a cleared Honorar submits
  // as a referee working for free. The `?? NaN` below is the other half.
  const handlePaymentChange = (newPayment: number) => {
    if (schiedsrichterPayload) {
      const entered = enteredNumber(newPayment);

      onSchiedsrichterChange({
        ...schiedsrichterPayload,
        payment: entered === null ? null : Math.round(entered),
      });
    }
  };

  // As the Mietpreis twin.
  const stepPayment = (delta: number) => {
    if (schiedsrichterPayload) {
      onSchiedsrichterChange({ ...schiedsrichterPayload, payment: Math.max(0, (schiedsrichterPayload.payment ?? 0) + delta) });
    }
  };

  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <PickOrCreateAutocomplete<FLSchiedsrichterAngezeigt>
        label="Schiedsrichter"
        fieldPath="schiedsrichter.schiedsrichter_id"
        placeholder="z.B. Pierluigi Collina"
        items={[...held, ...offered]}
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
        // Frozen without a referee, the Mietpreis field's reason: `handlePaymentChange` no-ops on a
        // null payload.
        isReadOnly={!schiedsrichterPayload}
        value={schiedsrichterPayload?.payment ?? NaN}
        onChange={handlePaymentChange}
        // On blur, for the Mietpreis field's reason: the same box with the same NaN window.
        onBlur={() => onValidateFields(["schiedsrichter.payment"])}
        onKeyDown={suppressEnterSubmit}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <FieldLabel
          path="schiedsrichter.payment"
          extraMarker={<ExpectedMarker path="schiedsrichter.payment" />}>
          Honorar
        </FieldLabel>
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
