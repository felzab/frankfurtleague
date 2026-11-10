import { AddressFields } from "@/kit/AddressFields";
import { FieldGroup } from "@/kit/FieldGroup";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";

import type { SpielortRules } from "./spielortRules";

const WORDS = COPY.admin.spielort;

/**
 * A new venue's inputs, in the create dialog over the venue list and over the match editor alike: its name and its
 * price, the venue's own as in its editor's first box, then its address under „Adresse“, a group of the dialog. Each
 * posts under its own name, which `createSpielort` reads.
 */
export function SpielortFields({
  rules,
  name,
}: {
  rules: SpielortRules;
  /** The name typed into the match editor's venue field before its create entry was chosen. */
  name?: string;
}) {
  const { required, nameMax, address } = rules;
  return (
    <>
      <TextField
        label={COPY.shared.name}
        name="name"
        width="standard"
        kind="text"
        defaultValue={name}
        isRequired={required.name}
        maxLength={nameMax}
      />
      <TextField
        label={WORDS.mietpreis}
        name="mietpreis"
        width="short"
        holds={5}
        kind="digits"
        unit={COPY.shared.unit.euro}
        isRequired={required.mietpreis}
      />
      <FieldGroup name={WORDS.address}>
        <AddressFields rules={address} />
      </FieldGroup>
    </>
  );
}
