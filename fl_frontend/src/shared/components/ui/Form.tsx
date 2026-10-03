import { useSyncExternalStore } from "react";

import { Form as HeroUIForm } from "@heroui/react/form";

import { RequiredSchemas } from "./RequiredMarks";

import type { DraftFormWiring } from "@/shared/hooks/useDraftFieldErrors";
import type { FormProps } from "@heroui/react/form";

const neverChanges = () => () => undefined;

/** `false` in the server's markup and through hydration, `true` once this page runs its own code. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
}

/**
 * In `native` mode react-aria commits on each DOM `change`, so an edited field cleared again paints the
 * browser's required message on the blur; `aria` leaves a missing value to `guardSubmit`
 * (`docs/frontend/spec.md :: I71`).
 */
export function Form({
  onSubmit,
  wiring: { ref, validationErrors, schemas },
  children,
  ...props
}: Omit<FormProps, "validationBehavior" | "action" | "method" | "onSubmit" | "validationErrors" | "ref"> & {
  // A handler, and no `action` at all: React resets a form whose `action` is a function, and
  // react-aria pushes each field's mount-time value back through its setter (`docs/frontend/spec.md :: I32`).
  onSubmit: () => void;
  /** Its draft hook's ref, error map and payload schemas, the last of which every shared field below reads its required mark off. */
  wiring: DraftFormWiring;
}) {
  const hydrated = useHydrated();

  return (
    <RequiredSchemas schemas={schemas}>
      <HeroUIForm
        {...props}
        // For the submit no handler catches, an Enter before hydration: by default a GET, putting every
        // field, an address among them, into the URL and each log keeping a query (`docs/frontend/spec.md :: I461`).
        method="post"
        ref={ref}
        validationErrors={validationErrors}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}>
        {/* The form's default button until hydration, and disabled: the browser then ignores an Enter no
            handler is there to catch (`docs/frontend/spec.md :: I461`). */}
        {!hydrated && (
          <button
            type="submit"
            disabled
            hidden
            aria-hidden="true"
            tabIndex={-1}
          />
        )}
        {children}
      </HeroUIForm>
    </RequiredSchemas>
  );
}
