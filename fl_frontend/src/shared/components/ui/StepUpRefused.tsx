import { STEP_UP_REFUSED } from "./stepUp";

/**
 * A refused passkey prompt, said under the control that opened it and nowhere else: the control
 * stays pressable for the next prompt, and a toast would be gone before that press.
 */
export function StepUpRefused({ refused }: { refused: boolean }) {
  if (!refused) return null;

  return (
    <p
      role="alert"
      className="w-full fluid-sm text-pretty text-danger-strong">
      {STEP_UP_REFUSED}
    </p>
  );
}
