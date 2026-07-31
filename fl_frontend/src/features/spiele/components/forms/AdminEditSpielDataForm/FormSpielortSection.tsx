import { Description, FieldError, Label, NumberField } from "@heroui/react";

import { postSpielortAction } from "@/features/spielorte/actions";
import SpielortFormFields from "@/features/spielorte/components/forms/SpielortFormFields";
import { FIELD_ERROR, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import { formatAddressFull } from "@/shared/utils/format";

import { InlineCreateAutocomplete } from "./InlineCreateAutocomplete";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpielOrtFieldDraft } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLAddress } from "@/shared/schemas";

type SpielortDraft = { name: string; address: FLAddress; default_mietpreis: number };

const EMPTY_DRAFT: SpielortDraft = {
  name: "",
  address: { strasse: "", hausnummer: "", plz: "", stadt: "Frankfurt am Main", stadtteil: "" },
  default_mietpreis: 0,
};

export default function FormSpielortSection({
  spielorte,
  ortPayload,
  onOrtChange,
}: {
  spielorte: FLSpielort[];
  ortPayload: FLSpielOrtFieldDraft | null;
  onOrtChange: (payload: FLSpielOrtFieldDraft | null) => void;
}) {
  // The picker hands over the resolved record. Looking it up here against `spielorte` would miss a
  // Spielort just created inline, which lives only in the picker's own list until the next server
  // render — the lookup silently failed and the "und zugewiesen" toast was a lie.
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
  const handleMietpreisChange = (newPrice: number) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: isNaN(newPrice) ? null : newPrice });
    }
  };

  return (
    <InlineCreateAutocomplete<FLSpielort, SpielortDraft>
      label="Spielort"
      placeholder="z.B. Sportpark Nord"
      name="spielOrtUI"
      items={spielorte}
      selectedId={ortPayload?.spielort_id ?? null}
      onSelect={handleOrtChange}
      description="Der Ort, an dem das Spiel ausgetragen wird"
      createHeading="Neuen Spielort anlegen"
      emptyStateText="Dieser Spielort existiert noch nicht."
      emptyDraft={EMPTY_DRAFT}
      renderDraftFields={(draft, setDraft, errors) => (
        <SpielortFormFields
          draft={draft}
          onChange={setDraft}
          errors={errors}
        />
      )}
      onCreate={(draft) =>
        postSpielortAction({
          name: draft.name,
          default_mietpreis: draft.default_mietpreis,
          address: draft.address,
        })
      }
      buildCreatedItem={(draft, createdId) => ({
        id: createdId,
        name: draft.name,
        address: draft.address,
        // Reproduces what the backend stores verbatim: `post_spielort` writes
        // `f"{name}, {address.to_string}, Deutschland"` (admin/router.py:143), and
        // `formatAddressFull` composes the same parts in the same order. `maps_link` is a plain
        // search string here, not a URL — `formatMapsLink` is what wraps one for an href.
        maps_link: `${draft.name}, ${formatAddressFull(draft.address)}`,
        default_mietpreis: draft.default_mietpreis,
        is_inactive: false,
      })}
      createdToast="Spielort erfolgreich angelegt und zugewiesen">
      {/** Mietpreis */}
      <NumberField
        minValue={0}
        // Named after its path in the patch payload, so a server-side zod error lands on this field
        // through `Form`'s `validationErrors` without a translation table.
        name="ort.mietpreis"
        value={ortPayload?.mietpreis ?? NaN}
        onChange={handleMietpreisChange}
        onKeyDown={suppressEnterSubmit}
        step={5}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <Label className={FIELD_LABEL}>Mietpreis</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border transition-colors">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Der Mietpreis für den Spielort</Description>
        <FieldError className={FIELD_ERROR} />
      </NumberField>
    </InlineCreateAutocomplete>
  );
}
