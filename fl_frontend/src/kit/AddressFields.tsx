import { COPY } from "@/core/copy";

import { FieldPair } from "./FieldPair";
import { TextField } from "./TextField";

import type { Copy } from "@/core/copy";

const WORDS = COPY.admin.spielort;

/** An address's boxes, by the names they post under. */
type AddressField = "street" | "house_number" | "postcode" | "district" | "city";

/** What a write asks of an address, read off its schema on the server, so the schema never reaches the browser. */
export type AddressRules = {
  required: Readonly<Record<AddressField, boolean>>;
  maxLength: Readonly<Record<Exclude<AddressField, "postcode">, number>>;
  /** The postcode's one length, which its box holds before the send as well. */
  postcodeLength: number;
};

/**
 * An address's lines, in a create dialog and an editor's box alike, on a venue and a club: the street and its number,
 * the postcode and its town, each pair one line of the address, sharing a row at every width, the postcode before its
 * town as a German address writes it, and the district. Each box posts under its own name; an editor's draft holds
 * the values through `draft`, a form holding its typed text itself names each box and keeps its text through `box`, and
 * without a draft a new address starts in the league's town.
 */
export function AddressFields({
  rules,
  draft,
  box,
  streetDescription,
}: {
  rules: AddressRules;
  draft?: { values: Readonly<Record<AddressField, string>>; set: (field: AddressField, value: string) => void };
  box?: (field: AddressField) => { name: string; defaultValue?: string; onChange: (value: string) => void };
  streetDescription?: Copy;
}) {
  const { required, maxLength, postcodeLength } = rules;
  const bound = (field: AddressField) => {
    if (draft !== undefined) return { name: field, value: draft.values[field], onChange: (value: string) => draft.set(field, value) };
    const held: { name: string; defaultValue?: string; onChange?: (value: string) => void } = box?.(field) ?? { name: field };
    return field === "city" ? { ...held, defaultValue: held.defaultValue ?? WORDS.cityDefault } : held;
  };
  return (
    <>
      <FieldPair
        short="second"
        phone="pair">
        <TextField
          label={WORDS.street}
          description={streetDescription}
          width="W3"
          kind="text"
          isRequired={required.street}
          maxLength={maxLength.street}
          {...bound("street")}
        />
        <TextField
          label={WORDS.houseNumber}
          width="C5"
          kind="text"
          isRequired={required.house_number}
          maxLength={maxLength.house_number}
          {...bound("house_number")}
        />
      </FieldPair>
      <FieldPair
        short="first"
        phone="pair">
        <TextField
          label={WORDS.postcode}
          width="C5"
          kind="digits"
          isRequired={required.postcode}
          maxLength={postcodeLength}
          minLength={postcodeLength}
          {...bound("postcode")}
        />
        <TextField
          label={WORDS.city}
          width="W3"
          kind="text"
          isRequired={required.city}
          maxLength={maxLength.city}
          {...bound("city")}
        />
      </FieldPair>
      <TextField
        label={WORDS.district}
        width="W3"
        kind="text"
        isRequired={required.district}
        maxLength={maxLength.district}
        {...bound("district")}
      />
    </>
  );
}
