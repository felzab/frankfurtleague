// eslint-disable-next-line no-restricted-imports -- the one wrapper every form renders through
import { Form as HeroUIForm } from "@heroui/react/form";

import type { FormProps } from "@heroui/react/form";

/**
 * In `native` mode react-aria commits on each DOM `change`, so an edited field cleared again paints the
 * browser's required message on the blur; `aria` leaves a missing value to `guardSubmit`
 * (`docs/frontend/spec.md :: I71`).
 */
export function Form(props: Omit<FormProps, "validationBehavior">) {
  return (
    <HeroUIForm
      {...props}
      validationBehavior="aria"
    />
  );
}
