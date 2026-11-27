import { COPY } from "@/core/copy/shared";

import { FieldPair } from "./FieldPair";
import { TextField } from "./TextField";

import type { Copy } from "@/core/copy";

const WORDS = COPY.shared.address;

/** An address's boxes, by the names they post under. */
type AddressField = "street" | "house_number" | "postcode" | "district" | "city";

/**
 * An address's lines, in a create dialog and an editor's box alike, on a venue and a club: the street and its number,
 * the postcode and its town, each pair one line of the address, sharing a row at every width, the postcode before its
 * town as a German address writes it, and the district. Each box posts under its own name, which its form holds to its
 * lane's rules; an editor's draft holds the values through `draft`, a form holding its typed text itself names each box
 * and keeps its text through `box`, and without a draft a new address starts in the league's town.
 */
export function AddressFields({
  draft,
  box,
  streetDescription,
}: {
  draft?: { values: Readonly<Record<AddressField, string>>; set: (field: AddressField, value: string) => void };
  box?: (field: AddressField) => { name: string; defaultValue?: string; onChange: (value: string) => void };
  streetDescription?: Copy;
}) {
  const bound = (field: AddressField) => {
    if (draft !== undefined) return { name: field, value: draft.values[field], onChange: (value: string) => draft.set(field, value) };
    const held: { name: string; defaultValue?: string; onChange?: (value: string) => void } = box?.(field) ?? { name: field };
    return field === "city" ? { ...held, defaultValue: held.defaultValue ?? WORDS.cityDefault } : held;
  };
  return (
    <>
      <FieldPair>
        <TextField
          label={WORDS.street}
          description={streetDescription}
          kind="text"
          {...bound("street")}
        />
        <TextField
          label={WORDS.houseNumber}
          holds={5}
          kind="text"
          {...bound("house_number")}
        />
      </FieldPair>
      <FieldPair>
        <TextField
          label={WORDS.postcode}
          holds={5}
          kind="digits"
          {...bound("postcode")}
        />
        <TextField
          label={WORDS.city}
          kind="text"
          {...bound("city")}
        />
      </FieldPair>
      <TextField
        label={WORDS.district}
        kind="text"
        {...bound("district")}
      />
    </>
  );
}
