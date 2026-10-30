import { FieldError } from "@heroui/react/field-error";

import { FieldLabel } from "@/shared/components/ui/FieldLabel";
import { FIELD_COUNT_INPUT_CLASSES, FIELD_ERROR_CLASSES, FIELD_GROUP_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { NumberField } from "@/shared/components/ui/NumberField";

import { ExpectedMarker } from "./ExpectedMarker";
import { PickOrCreateAutocomplete } from "./PickOrCreateAutocomplete";
import { StepFiveButton } from "./StepFiveButton";
import { suppressEnterSubmit } from "./suppressEnterSubmit";

import type { SpielFieldPath } from "@/features/spiele/draftStatus";
import type { FLSpielOrtFieldDraft } from "@/features/spiele/types";
import type { FLSpielort } from "@/features/spielorte/schemas";

/**
 * What the picker offers and what a pick writes back, which is every field of a venue this section
 * reads. Narrower than `FLSpielort` so the held record below can be built from the fixture, which
 * carries no address.
 */
type SpielortAngebot = Pick<FLSpielort, "id" | "name" | "maps_link" | "default_mietpreis">;

/** One mapping for a pick and for the editor's create dialog, so a venue created there books what a picked one would. */
export const toOrtDraft = (venue: SpielortAngebot): FLSpielOrtFieldDraft => ({
  spielort_id: venue.id,
  name: venue.name,
  maps_link: venue.maps_link,
  mietpreis: venue.default_mietpreis,
});

/**
 * The price is subordinate to the choice rather than its peer, hence 2fr/1fr. Prefilled from the
 * venue's `default_mietpreis` and then editable, what a fixture cost being the fixture's property.
 */
export function FormSpielortSection({
  spielorte,
  created,
  ortPayload,
  onOrtChange,
  onRequestCreate,
  onValidateFields,
}: {
  spielorte: FLSpielort[];
  created: FLSpielort[];
  ortPayload: FLSpielOrtFieldDraft | null;
  onOrtChange: (payload: FLSpielOrtFieldDraft | null) => void;
  onRequestCreate: () => void;
  onValidateFields: (paths: readonly string[]) => void;
}) {
  // The venue this fixture ALREADY holds, where the list offers it nowhere: the default read drops
  // every retired row, so without this the trigger renders blank on a fixture that HAS a venue.
  const held: SpielortAngebot[] =
    ortPayload === null || spielorte.some((candidate) => candidate.id === ortPayload.spielort_id)
      ? []
      : [
          {
            id: ortPayload.spielort_id,
            name: ortPayload.name,
            maps_link: ortPayload.maps_link,
            // Fills the type alone, never a draft: react-stately drops a re-pick of the selected key, and
            // this entry leaves the list once the pick moves, so no pick ever reads it.
            default_mietpreis: ortPayload.mietpreis ?? 0,
          },
        ];

  // The picker hands over the resolved record: looking it up against `spielorte` would miss one
  // just created in the dialog, a silent failure behind a success toast.
  const handleOrtChange = (resolvedOrt: SpielortAngebot | null) => {
    onOrtChange(resolvedOrt ? toOrtDraft(resolvedOrt) : null);
  };

  // `null` is an emptied field, not a zero price. `Math.round` because a decimal is typable, the
  // field carrying no `step`, and rounding at entry beats a schema rejection.
  const handleMietpreisChange = (entered: number | null) => {
    if (ortPayload) {
      onOrtChange({ ...ortPayload, mietpreis: entered === null ? null : Math.round(entered) });
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
      <PickOrCreateAutocomplete<SpielortAngebot>
        label="Spielort"
        fieldPath="ort.spielort_id"
        placeholder="z.B. Sportpark Nord"
        items={[...held, ...spielorte]}
        created={created}
        selectedId={ortPayload?.spielort_id ?? null}
        onSelect={handleOrtChange}
        createLabel="Neuen Spielort anlegen"
        emptyStateText="Dieser Spielort existiert noch nicht."
        onRequestCreate={onRequestCreate}
      />

      <NumberField
        minValue={0}
        name="ort.mietpreis"
        // Frozen without a venue rather than merely unstepped: `handleMietpreisChange` no-ops on a
        // null payload, so an editable box discards every keystroke. Read-only for
        // `SaisonRuleNumberField`'s reason — it stays a tab stop and stays in the form.
        isReadOnly={!ortPayload}
        value={ortPayload?.mietpreis ?? null}
        onChange={handleMietpreisChange}
        // On blur: a cleared box is empty until the first digit of its replacement is typed, and
        // complaining in that window is the eager-validation failure.
        onBlur={() => onValidateFields(["ort.mietpreis"])}
        onKeyDown={suppressEnterSubmit}
        formatOptions={{
          currency: "EUR",
          currencySign: "accounting",
          style: "currency",
        }}>
        <FieldLabel<SpielFieldPath>
          path="ort.mietpreis"
          extraMarker={<ExpectedMarker path="ort.mietpreis" />}>
          Mietpreis
        </FieldLabel>
        <NumberField.Group className={FIELD_GROUP_CLASSES}>
          <StepFiveButton
            direction="decrement"
            isDisabled={!ortPayload}
            onStep={() => stepMietpreis(-5)}
          />
          <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
          <StepFiveButton
            direction="increment"
            isDisabled={!ortPayload}
            onStep={() => stepMietpreis(5)}
          />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR_CLASSES} />
      </NumberField>
    </div>
  );
}
