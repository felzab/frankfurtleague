import { COPY } from "@/core/copy";

import { FieldPair } from "./FieldPair";
import { TextField } from "./TextField";

import type { Copy } from "@/core/copy";

const WORDS = COPY.admin.spielort;

/** An address's boxes, by the names they post under. */
type AddressField = "strasse" | "hausnummer" | "plz" | "stadtteil" | "stadt";

/** What a write asks of an address, read off its schema on the server, so the schema never reaches the browser. */
export type AddressRules = {
  required: Readonly<Record<AddressField, boolean>>;
  maxLength: Readonly<Record<Exclude<AddressField, "plz">, number>>;
  /** The postcode's one length, which its box holds before the send as well. */
  plzLength: number;
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
  const { required, maxLength, plzLength } = rules;
  const bound = (field: AddressField) => {
    if (draft !== undefined) return { name: field, value: draft.values[field], onChange: (value: string) => draft.set(field, value) };
    const held: { name: string; defaultValue?: string; onChange?: (value: string) => void } = box?.(field) ?? { name: field };
    return field === "stadt" ? { ...held, defaultValue: held.defaultValue ?? WORDS.stadtDefault } : held;
  };
  return (
    <>
      <FieldPair
        short="second"
        phone="pair">
        <TextField
          label={WORDS.strasse}
          description={streetDescription}
          width="W3"
          kind="text"
          isRequired={required.strasse}
          maxLength={maxLength.strasse}
          {...bound("strasse")}
        />
        <TextField
          label={WORDS.hausnummer}
          width="C5"
          kind="text"
          isRequired={required.hausnummer}
          maxLength={maxLength.hausnummer}
          {...bound("hausnummer")}
        />
      </FieldPair>
      <FieldPair
        short="first"
        phone="pair">
        <TextField
          label={WORDS.plz}
          width="C5"
          kind="digits"
          isRequired={required.plz}
          maxLength={plzLength}
          minLength={plzLength}
          {...bound("plz")}
        />
        <TextField
          label={WORDS.stadt}
          width="W3"
          kind="text"
          isRequired={required.stadt}
          maxLength={maxLength.stadt}
          {...bound("stadt")}
        />
      </FieldPair>
      <TextField
        label={WORDS.stadtteil}
        width="W3"
        kind="text"
        isRequired={required.stadtteil}
        maxLength={maxLength.stadtteil}
        {...bound("stadtteil")}
      />
    </>
  );
}
