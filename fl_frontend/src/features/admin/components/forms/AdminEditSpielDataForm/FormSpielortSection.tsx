import { Description, Label, NumberField } from "@heroui/react";

import { postSpielortAction } from "@/features/spielorte/actions";
import SpielortFormFields from "@/features/spielorte/components/forms/SpielortFormFields";

import { InlineCreateAutocomplete } from "./InlineCreateAutocomplete";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { FLSpielOrtField } from "@/features/spiele/schemas";
import type { FLSpielort } from "@/features/spielorte/schemas";
import type { FLAddress } from "@/shared/schemas";
import type { Key } from "@heroui/react";

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
  ortPayload: FLSpielOrtField | null;
  onOrtChange: (payload: FLSpielOrtField | null) => void;
}) {
  const handleOrtChange = (key: Key | null) => {
    if (!key) {
      onOrtChange(null);
      return;
    }

    const resolvedOrt = spielorte.find((o: FLSpielort) => o.id === key);
    if (resolvedOrt) {
      onOrtChange({
        spielort_id: resolvedOrt.id,
        name: resolvedOrt.name,
        maps_link: resolvedOrt.maps_link,
        mietpreis: resolvedOrt.default_mietpreis,
      });
    }
  };

  const handleMietpreisChange = (newPrice: number) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: isNaN(newPrice) ? 0 : newPrice });
    }
  };

  return (
    <InlineCreateAutocomplete<FLSpielort, SpielortDraft>
      label="Spielort"
      name="spielOrtUI"
      items={spielorte}
      selectedId={ortPayload?.spielort_id ?? null}
      onSelect={handleOrtChange}
      description="Der Ort, an dem das Spiel ausgetragen wird"
      createHeading="Neuen Spielort anlegen"
      emptyStateText="Dieser Spielort existiert noch nicht."
      emptyDraft={EMPTY_DRAFT}
      renderDraftFields={(draft, setDraft) => (
        <SpielortFormFields
          draft={draft}
          onChange={setDraft}
        />
      )}
      onCreate={(draft) =>
        postSpielortAction({
          name: draft.name,
          default_mietpreis: draft.default_mietpreis,
          address: draft.address,
        })
      }
      createdToast="Spielort erfolgreich angelegt">
      {/** Mietpreis */}
      <NumberField
        minValue={0}
        name="spielortMietpreisUI"
        value={ortPayload?.mietpreis ?? NaN}
        onChange={handleMietpreisChange}
        onKeyDown={suppressEnterSubmit}
        step={5}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <Label className="text-fluid-xs text-foreground font-bold">Mietpreis</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <Description className="text-fluid-xxs text-foreground-muted">Der Mietpreis für den Spielort</Description>
      </NumberField>
    </InlineCreateAutocomplete>
  );
}
