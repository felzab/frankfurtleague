import { FieldGroup } from "@/kit/FieldGroup";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { CREATE_RULES } from "@/features/schiedsrichter/fieldRules";

const FACTS = COPY.account.entries.facts;

/**
 * A new referee's inputs in the create dialog over the list, in the order of the editor's boxes, as a new venue's
 * follow its editor's: the person's own, the name, the school and the fee, then how to reach them under
 * „Kontaktdaten“, a group of the dialog, the address the confirmation link goes to and the phone. Each posts under the
 * name `createSchiedsrichter` reads, held to the create's own rules. Drawn on the server, so the create's schema never
 * reaches the browser.
 */
export function SchiedsrichterFields() {
  const { required, max } = CREATE_RULES;
  return (
    <>
      <TextField
        label={COPY.shared.name}
        name="name"
        width="W3"
        kind="text"
        isRequired={required.name}
        maxLength={max.name}
      />
      <TextField
        label={FACTS.school}
        name="schule"
        width="W3"
        kind="text"
        isRequired={required.schule}
        maxLength={max.schule}
      />
      <TextField
        label={COPY.admin.honorar}
        name="honorar"
        width="C5"
        kind="digits"
        unit={COPY.shared.unit.euro}
        isRequired={required.honorar}
      />
      <FieldGroup name={COPY.admin.schiedsrichter.kontaktdaten}>
        <TextField
          label={COPY.signIn.address}
          name="email"
          width="W3"
          kind="email"
          isRequired={required.email}
          maxLength={max.email}
        />
        <TextField
          label={FACTS.phone}
          name="telefon"
          width="W3"
          kind="tel"
          isRequired={required.telefon}
        />
      </FieldGroup>
    </>
  );
}
