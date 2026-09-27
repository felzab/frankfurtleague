import { STEP_UP_REFUSED } from "./stepUp";

/**
 * A refused confirmation, said under the control that opened it and nowhere else: the control
 * stays pressable for the next attempt, and a toast would be gone before that press.
 */
export function StepUpRefused({
  refused,
  message = STEP_UP_REFUSED,
}: {
  refused: boolean;
  /** The passkey prompt's sentence unless the confirmation took another factor. */
  message?: string;
}) {
  if (!refused) return null;

  return (
    <p
      role="alert"
      className="w-full fluid-sm text-pretty text-danger-strong">
      {message}
    </p>
  );
}
