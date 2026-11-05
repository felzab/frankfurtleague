import { FieldGroup } from "@/kit/FieldGroup";
import { FieldPair } from "@/kit/FieldPair";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";

import type { SpielortRules } from "./spielortRules";

const WORDS = COPY.admin.spielort;

/**
 * A new venue's inputs, in the create dialog over the venue list and over the match editor alike: its name and its
 * price, the venue's own as in its editor's first box, then its address under „Adresse“, a group of the dialog. Each
 * posts under its own name, which `createSpielort` reads. The street and its number, and the postcode and its town,
 * each form one line of the address and share a row at every width, the postcode before its town as a German address
 * writes it.
 */
export function SpielortFields({
  rules,
  name,
}: {
  rules: SpielortRules;
  /** The name typed into the match editor's venue field before its create entry was chosen. */
  name?: string;
}) {
  const { required, maxLength } = rules;
  return (
    <>
      <TextField
        label={COPY.shared.name}
        name="name"
        width="W3"
        kind="text"
        defaultValue={name}
        isRequired={required.name}
      />
      <TextField
        label={WORDS.mietpreis}
        name="mietpreis"
        width="C5"
        kind="digits"
        unit={COPY.shared.unit.euro}
        isRequired={required.mietpreis}
      />
      <FieldGroup name={WORDS.address}>
        <FieldPair
          short="second"
          phone="pair">
          <TextField
            label={WORDS.strasse}
            name="strasse"
            width="W3"
            kind="text"
            isRequired={required.strasse}
            maxLength={maxLength.strasse}
          />
          <TextField
            label={WORDS.hausnummer}
            name="hausnummer"
            width="C5"
            kind="text"
            isRequired={required.hausnummer}
            maxLength={maxLength.hausnummer}
          />
        </FieldPair>
        <TextField
          label={WORDS.stadtteil}
          name="stadtteil"
          width="W3"
          kind="text"
          isRequired={required.stadtteil}
          maxLength={maxLength.stadtteil}
        />
        <FieldPair
          short="first"
          phone="pair">
          <TextField
            label={WORDS.plz}
            name="plz"
            width="C5"
            kind="digits"
            isRequired={required.plz}
            // The write's postcode is five digits, a rule the field holds itself before the send as well.
            maxLength={5}
            minLength={5}
          />
          <TextField
            label={WORDS.stadt}
            name="stadt"
            width="W3"
            kind="text"
            defaultValue={WORDS.stadtDefault}
            isRequired={required.stadt}
            maxLength={maxLength.stadt}
          />
        </FieldPair>
      </FieldGroup>
    </>
  );
}
