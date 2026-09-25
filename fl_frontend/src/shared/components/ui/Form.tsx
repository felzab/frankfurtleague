import { Form as HeroUIForm } from "@heroui/react/form";

import type { FormProps } from "@heroui/react/form";

/**
 * In `native` mode react-aria commits on each DOM `change`, so an edited field cleared again paints the
 * browser's required message on the blur; `aria` leaves a missing value to `guardSubmit`
 * (`docs/frontend/spec.md :: I71`).
 */
export function Form({
  onSubmit,
  ...props
}: Omit<FormProps, "validationBehavior" | "action" | "onSubmit"> & {
  // A handler, and no `action` at all: React resets a form whose `action` is a function, and
  // react-aria pushes each field's mount-time value back through its setter (`docs/frontend/spec.md :: I32`).
  onSubmit: () => void;
}) {
  return (
    <HeroUIForm
      {...props}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    />
  );
}
