import { FieldError, Label, NumberField } from "@heroui/react";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { SchiedsrichterFormFields } from "@/features/schiedsrichter/components/forms/SchiedsrichterFormFields";
import { FIELD_ERROR, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";

import { InlineCreateAutocomplete } from "./InlineCreateAutocomplete";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielSchiedsrichterFieldDraft } from "@/features/spiele/schemas";
import type { FLKontakt } from "@/shared/schemas";

type SchiedsrichterDraft = { name: string; schule: string; kontakt: FLKontakt; default_payment: number };

const EMPTY_DRAFT: SchiedsrichterDraft = {
  name: "",
  schule: "",
  kontakt: { telefon: "", email: "" },
  default_payment: 0,
};

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
    <InlineCreateAutocomplete<FLSchiedsrichter, SchiedsrichterDraft>
      label="Schiedsrichter"
      placeholder="z.B. Pierluigi Collina"
      name="schiedsrichterUI"
      items={schiedsrichter}
      selectedId={schiedsrichterPayload?.schiedsrichter_id ?? null}
      onSelect={handleSchiedsrichterChange}
      createHeading="Neuen Schiedsrichter anlegen"
      emptyStateText="Dieser Schiedsrichter existiert noch nicht."
      emptyDraft={EMPTY_DRAFT}
      renderDraftFields={(draft, setDraft, errors) => (
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
          errors={errors}
        />
      )}
      onCreate={(draft) =>
        postSchiedsrichterAction({
          name: draft.name,
          schule: draft.schule,
          kontakt: draft.kontakt,
          default_payment: draft.default_payment,
        })
      }
      buildCreatedItem={(draft, createdId) => ({
        id: createdId,
        name: draft.name,
        schule: draft.schule,
        kontakt: draft.kontakt,
        default_payment: draft.default_payment,
        // A referee that has just been created is current, and `null` is what current means (ADR-0032).
        inactive_since: null,
      })}
      createdToast="Schiedsrichter erfolgreich angelegt und zugewiesen">
      {/** Schiedsrichter Entschädigung */}
      <NumberField
        minValue={0}
        // Named after its path in the patch payload — see the note on `FormSpielortSection`.
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
        <Label className={FIELD_LABEL}>Entschädigung</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border transition-colors">
          <NumberField.DecrementButton />
          <NumberField.Input className="fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR} />
      </NumberField>
    </InlineCreateAutocomplete>
  );
}
