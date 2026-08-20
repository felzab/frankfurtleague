import { FieldError, NumberField } from "@heroui/react";

import { AdminCreateSpielortForm } from "@/features/spielorte/components/forms/AdminCreateSpielortForm";
import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT, FIELD_ERROR, FIELD_GROUP } from "@/shared/components/ui/formFieldStyles";
import { FormModal } from "@/shared/components/ui/FormModal";

import { ExpectedMarker } from "./ExpectedMarker";
import { PickOrCreateAutocomplete } from "./PickOrCreateAutocomplete";
import { StepFiveButton } from "./StepFiveButton";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpielOrtFieldDraft } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";

/**
 * The price is subordinate to the choice rather than its peer, hence 2fr/1fr. Prefilled from the
 * venue's `default_mietpreis` and then editable, what a fixture cost being the fixture's property.
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
  // The picker hands over the resolved record: looking it up against `spielorte` would miss one
  // just created in the modal, a silent failure behind a success toast.
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

  // NaN is an emptied field, not a zero price. `Math.round` because a decimal is typable, the
  // field carrying no `step`, and rounding at entry beats a schema rejection.
  const handleMietpreisChange = (newPrice: number) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: isNaN(newPrice) ? null : Math.round(newPrice) });
    }
  };

  // An empty field steps from 0, and the floor is the field's own minimum.
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
        // On blur: a cleared box is `NaN` until the first digit of its replacement is typed, and
        // complaining in that window is the eager-validation failure.
        onBlur={() => onValidateFields(["ort.mietpreis"])}
        onKeyDown={suppressEnterSubmit}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <FieldLabel
          path="ort.mietpreis"
          extraMarker={<ExpectedMarker path="ort.mietpreis" />}>
          Mietpreis
        </FieldLabel>
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
