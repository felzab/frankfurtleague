import { Form as HeroUIForm } from "@heroui/react/form";

import { RequiredSchemas } from "./RequiredMarks";

import type { DraftFormWiring } from "@/shared/hooks/useDraftFieldErrors";
import type { FormProps } from "@heroui/react/form";

/**
 * In `native` mode react-aria commits on each DOM `change`, so an edited field cleared again paints the
 * browser's required message on the blur; `aria` leaves a missing value to `guardSubmit`
 * (`docs/frontend/spec.md :: I71`).
 */
export function Form({
  onSubmit,
  wiring: { ref, validationErrors, schemas },
  ...props
}: Omit<FormProps, "validationBehavior" | "action" | "onSubmit" | "validationErrors" | "ref"> & {
  // A handler, and no `action` at all: React resets a form whose `action` is a function, and
  // react-aria pushes each field's mount-time value back through its setter (`docs/frontend/spec.md :: I32`).
  onSubmit: () => void;
  /** Its draft hook's ref, error map and payload schemas, the last of which every shared field below reads its required mark off. */
  wiring: DraftFormWiring;
}) {
  return (
    <RequiredSchemas schemas={schemas}>
      <HeroUIForm
        {...props}
        ref={ref}
        validationErrors={validationErrors}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      />
    </RequiredSchemas>
  );
}
