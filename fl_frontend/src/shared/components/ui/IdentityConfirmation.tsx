"use client";

import { Button } from "@heroui/react/button";

import { STEP_UP_LABEL, STEP_UP_REFUSED, usePasskeyStepUp } from "@/shared/hooks/usePasskeyStepUp";

import { formButton } from "./formButtons";

import type { ReactNode } from "react";

/** The panel's heading, for whichever surface frames it: a dialog's title or a section's. */
export const IDENTITY_CONFIRMATION_TITLE = "Bestätige, dass Du es bist";

// Props only, so any surface asking for a confirmation reuses this one: the code half is its
// caller's, the code step living in a feature slice this layer may not import.
/** A caller re-reads whatever it drew off the session the confirmation ended before it acts. */
export function IdentityConfirmation({
  hinweis,
  codeHalf,
  istInhaber,
  onConfirmed,
}: {
  /** Why the surface asks, in its own words. */
  hinweis: string;
  /** The code-by-mail half, `null` where the holder may confirm by passkey alone. */
  codeHalf: ReactNode;
  /** Required: a confirmation of another account's is none of the holder's. */
  istInhaber: () => Promise<boolean>;
  onConfirmed: () => void;
}) {
  const { stepUp, isPending, refused } = usePasskeyStepUp(istInhaber);

  return (
    <div className="flex flex-col gap-4">
      <p className="muted-hint text-pretty">{hinweis}</p>

      <Button
        type="button"
        variant="primary"
        isPending={isPending}
        onPress={() => void stepUp().then((confirmed) => confirmed && onConfirmed())}
        className={formButton({ intent: "submit", fullWidth: true })}>
        {isPending ? "Bestätigt..." : STEP_UP_LABEL}
      </Button>

      {refused && <StepUpRefusal />}

      {codeHalf}
    </div>
  );
}

/** The failed confirmation's own line, under whichever control ran it. */
export function StepUpRefusal() {
  return (
    <p
      role="alert"
      className="fluid-sm text-pretty text-danger-strong">
      {STEP_UP_REFUSED}
    </p>
  );
}
