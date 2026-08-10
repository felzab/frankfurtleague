import { FieldError, NumberField } from "@heroui/react";

import { AdminCreateSpielortForm } from "@/features/spielorte/components/forms/AdminCreateSpielortForm";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { FormModal } from "@/shared/components/ui/FormModal";

import { FieldLabel } from "./FieldLabel";
import { PickOrCreateAutocomplete } from "./PickOrCreateAutocomplete";
import { StepFiveButton } from "./StepFiveButton";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpielOrtFieldDraft } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";

/**
 * Which venue, and what it costs.
 *
 * The price is subordinate to the choice rather than its peer — it is a property *of* the venue — so the
 * two sit in a 2fr/1fr grid instead of a 50/50 one. It is prefilled from the venue's own
 * `default_mietpreis` and then editable, because what a fixture actually cost is a property of the
 * fixture (ADR-0021).
 */
export function FormSpielortSection({
  spielorte,
  ortPayload,
  onOrtChange,
  onValidateFields,
}: {
  spielorte: FLSpielort[];
  ortPayload: FLSpielOrtFieldDraft | null;
  onOrtChange: (payload: FLSpielOrtFieldDraft | null) => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  // The picker hands over the resolved record. Looking it up here against `spielorte` would miss a
  // Spielort just created in the modal, which lives only in the picker's own list until the next
  // server render — a silent failure behind a success toast.
  const handleOrtChange = (resolvedOrt: FLSpielort | null) => {
    onOrtChange(
      resolvedOrt
        ? {
            spielort_id: resolvedOrt.id,
            name: resolvedOrt.name,
            maps_link: resolvedOrt.maps_link,
            mietpreis: resolvedOrt.default_mietpreis,
          }
        : null,
    );
  };

  // NaN is an emptied field, not a zero price — see the note on `FormSchiedsrichterSection`.
  // `Math.round`, because a decimal is typable (the field carries no `step`) and the payload wants an
  // integer: rounding at entry beats a schema rejection.
  const handleMietpreisChange = (newPrice: number) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: isNaN(newPrice) ? null : Math.round(newPrice) });
    }
  };

  // The ±5 buttons' own arithmetic: an empty field steps from 0, and the floor is the field's own
  // minimum. `?? null` twice, because `mietpreis` is already `number | null`.
  const stepMietpreis = (delta: number) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: Math.max(0, (ortPayload.mietpreis ?? 0) + delta) });
    }
  };

  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <PickOrCreateAutocomplete<FLSpielort>
        label="Spielort"
        fieldPath="ort.spielort_id"
        placeholder="z.B. Sportpark Nord"
        items={spielorte}
        selectedId={ortPayload?.spielort_id ?? null}
        onSelect={handleOrtChange}
        createLabel="Neuen Spielort anlegen"
        emptyStateText="Dieser Spielort existiert noch nicht."
        renderCreateModal={({ isOpen, onClose, onCreated }) => (
          <FormModal
            isOpen={isOpen}
            onClose={onClose}
            heading="Spielort anlegen">
            <AdminCreateSpielortForm
              onClose={onClose}
              onCreated={onCreated}
            />
          </FormModal>
        )}
      />

      <NumberField
        minValue={0}
        name="ort.mietpreis"
        value={ortPayload?.mietpreis ?? NaN}
        onChange={handleMietpreisChange}
        // On blur, not on change: a cleared box is `NaN` for as long as it takes to type the first
        // digit of the replacement, and complaining in that window is the eager-validation failure
        // (`useDraftValidation`).
        onBlur={() => onValidateFields(["ort.mietpreis"])}
        onKeyDown={suppressEnterSubmit}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <FieldLabel path="ort.mietpreis">Mietpreis</FieldLabel>
        <NumberField.Group className={FIELD_GROUP}>
          <StepFiveButton
            direction="decrement"
            isDisabled={!ortPayload}
            onStep={() => stepMietpreis(-5)}
          />
          <NumberField.Input className={FIELD_COUNT_INPUT} />
          <StepFiveButton
            direction="increment"
            isDisabled={!ortPayload}
            onStep={() => stepMietpreis(5)}
          />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR} />
      </NumberField>
    </div>
  );
}
