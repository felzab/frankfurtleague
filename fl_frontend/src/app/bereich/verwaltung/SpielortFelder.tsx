import { FieldPair } from "@/kit/FieldPair";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";

import type { SpielortRegeln } from "./spielortRegeln";

const WORTE = COPY.verwaltung.spielort;

/**
 * A new venue's inputs, in the create dialog over the venue list and over the match editor alike: its name, its
 * address and its price. Each posts under its own name, which `spielortAnlegen` reads. The street and its
 * number, and the postcode and its town, each form one line of the address and share a row at every width, the
 * postcode before its town as a German address writes it.
 */
export function SpielortFelder({
  regeln,
  name,
}: {
  regeln: SpielortRegeln;
  /** The name typed into the match editor's venue field before its create entry was chosen. */
  name?: string;
}) {
  const { pflicht, hoechstens } = regeln;
  return (
    <>
      <TextField
        label={WORTE.name}
        name="name"
        width="W3"
        kind="text"
        defaultValue={name}
        isRequired={pflicht.name}
      />
      <FieldPair
        short="second"
        phone="pair">
        <TextField
          label={WORTE.strasse}
          name="strasse"
          width="W3"
          kind="text"
          isRequired={pflicht.strasse}
          maxLength={hoechstens.strasse}
        />
        <TextField
          label={WORTE.hausnummer}
          name="hausnummer"
          width="C5"
          kind="text"
          isRequired={pflicht.hausnummer}
          maxLength={hoechstens.hausnummer}
        />
      </FieldPair>
      <TextField
        label={WORTE.stadtteil}
        name="stadtteil"
        width="W3"
        kind="text"
        isRequired={pflicht.stadtteil}
        maxLength={hoechstens.stadtteil}
      />
      <FieldPair
        short="first"
        phone="pair">
        <TextField
          label={WORTE.plz}
          name="plz"
          width="C5"
          kind="digits"
          isRequired={pflicht.plz}
          // The write's postcode is five digits (`fl_frontend/src/shared/schemas.ts :: FLAddressSchema`), a rule
          // the field holds itself: `spielortAnlegen` answers the write schema's refusals as the unexpected
          // failure, their words being the old pages'.
          maxLength={5}
          minLength={5}
        />
        <TextField
          label={WORTE.stadt}
          name="stadt"
          width="W3"
          kind="text"
          defaultValue={WORTE.stadtVorgabe}
          isRequired={pflicht.stadt}
          maxLength={hoechstens.stadt}
        />
      </FieldPair>
      <TextField
        label={WORTE.mietpreis}
        name="mietpreis"
        width="C5"
        kind="digits"
        unit={COPY.shared.einheit.euro}
        isRequired={pflicht.mietpreis}
      />
    </>
  );
}
