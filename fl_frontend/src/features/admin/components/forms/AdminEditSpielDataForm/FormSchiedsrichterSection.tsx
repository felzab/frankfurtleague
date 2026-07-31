import { Description, Label, NumberField } from "@heroui/react";

import { postSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import SchiedsrichterFormFields from "@/features/schiedsrichter/components/forms/SchiedsrichterFormFields";

import { InlineCreateAutocomplete } from "./InlineCreateAutocomplete";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";
import type { FLSpielSchiedsrichterField } from "@/features/spiele/schemas";
import type { FLKontakt } from "@/shared/schemas";
import type { Key } from "@heroui/react";

type SchiedsrichterDraft = { name: string; schule: string; kontakt: FLKontakt; default_payment: number };

const EMPTY_DRAFT: SchiedsrichterDraft = {
  name: "",
  schule: "",
  kontakt: { telefon: "", email: "" },
  default_payment: 0,
};

export default function FormSchiedsrichterSection({
  schiedsrichter,
  schiedsrichterPayload,
  onSchiedsrichterChange,
}: {
  schiedsrichter: FLSchiedsrichter[];
  schiedsrichterPayload: FLSpielSchiedsrichterField | null;
  onSchiedsrichterChange: (payload: FLSpielSchiedsrichterField | null) => void;
}) {
  const handleSchiedsrichterChange = (key: Key | null) => {
    if (!key) {
      onSchiedsrichterChange(null);
      return;
    }

    const resolvedSchiedsrichter = schiedsrichter.find((s: FLSchiedsrichter) => s.id === key);
    if (resolvedSchiedsrichter) {
      onSchiedsrichterChange({
        schiedsrichter_id: resolvedSchiedsrichter.id,
        name: resolvedSchiedsrichter.name,
        payment: resolvedSchiedsrichter.default_payment,
      });
    }
  };

  const handlePaymentChange = (newPayment: number) => {
    if (schiedsrichterPayload) {
      onSchiedsrichterChange({
        ...schiedsrichterPayload,
        payment: isNaN(newPayment) ? 0 : newPayment,
      });
    }
  };

  return (
    <InlineCreateAutocomplete<FLSchiedsrichter, SchiedsrichterDraft>
      label="Schiedsrichter"
      name="schiedsrichterUI"
      items={schiedsrichter}
      selectedId={schiedsrichterPayload?.schiedsrichter_id ?? null}
      onSelect={handleSchiedsrichterChange}
      description="Der Schiedsrichter des Spiels"
      createHeading="Neuen Schiedsrichter anlegen"
      emptyStateText="Dieser Schiedsrichter existiert noch nicht."
      emptyDraft={EMPTY_DRAFT}
      renderDraftFields={(draft, setDraft) => (
        <SchiedsrichterFormFields
          draft={draft}
          onChange={setDraft}
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
      createdToast="Schiedsrichter erfolgreich angelegt">
      {/** Schiedsrichter Entschädigung */}
      <NumberField
        minValue={0}
        name="schiedsrichterPaymentUI"
        value={schiedsrichterPayload?.payment ?? NaN}
        onChange={handlePaymentChange}
        onKeyDown={suppressEnterSubmit}
        step={5}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <Label className="text-fluid-xs text-foreground font-bold">Entschädigung</Label>
        <NumberField.Group className="border-border bg-surface text-foreground focus-within:border-brand rounded-lg border transition-colors focus-within:ring-0">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Die Entschädigung für den Schiedsrichter</Description>
      </NumberField>
    </InlineCreateAutocomplete>
  );
}
