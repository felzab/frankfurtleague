import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { CREATE_RULES } from "@/features/schiedsrichter/fieldRules";
import { FieldGroup } from "@/kit/FieldGroup";
import { TextField } from "@/kit/TextField";

const FACTS = COPY.shared.facts;

/**
 * A new referee's inputs in the create dialog over the list, in the order of the editor's boxes, as a new venue's
 * follow its editor's: the person's own, the name, the school and the fee, then how to reach them under
 * „Kontaktdaten“, a group of the dialog, the address the confirmation link goes to and the phone. Each posts under the
 * name `createSchiedsrichter` reads, held to the create's own rules. Drawn on the server, so the create's schema never
 * reaches the browser.
 */
export function SchiedsrichterFields() {
  const { required, max, pattern } = CREATE_RULES;
  return (
    <>
      <TextField
        label={COPY.shared.name}
        name="name"
        kind="text"
        pattern={pattern.name}
        example={COPY.shared.field.exampleName}
        isRequired={required.name}
        maxLength={max.name}
      />
      <TextField
        label={FACTS.school}
        name="schule"
        kind="text"
        isRequired={required.schule}
        maxLength={max.schule}
      />
      <TextField
        label={COPY.shared.payment}
        name="default_payment"
        holds={5}
        kind="digits"
        unit={COPY.shared.unit.euro}
        isRequired={required.default_payment}
      />
      <FieldGroup name={ADMIN_COPY.schiedsrichter.kontaktData}>
        <TextField
          label={COPY.shared.emailAddress}
          name="email"
          kind="email"
          isRequired={required.email}
          maxLength={max.email}
        />
        <TextField
          label={FACTS.phone}
          name="phone"
          kind="tel"
          pattern={pattern.phone}
          isRequired={required.phone}
        />
      </FieldGroup>
    </>
  );
}
