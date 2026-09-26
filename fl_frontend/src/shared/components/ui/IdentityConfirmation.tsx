"use client";

import { useState } from "react";

import { Button } from "@heroui/react/button";

import { authClient } from "@/core/authClient";

import { formButton } from "./formButtons";

import type { ReactNode } from "react";

/** The panel's heading, for whichever surface frames it: a dialog's title or a section's. */
export const IDENTITY_CONFIRMATION_TITLE = "Bestätige, dass Du es bist";

/** The one refusal a passkey half can meet: a cancelled prompt, an unknown authenticator and an unverified one read alike. */
const NICHT_BESTAETIGT = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

// Props only, so any surface asking for a confirmation reuses this one: the code half is its
// caller's, the code step living in a feature slice this layer may not import.
/**
 * A confirmation is a fresh sign-in: the assertion mints a new session and the one this page ran in
 * ends with it, so a caller re-reads whatever it drew off the old one before it acts
 * (`docs/frontend/spec.md :: I413`).
 */
export function IdentityConfirmation({
  hinweis,
  codeHalf,
  onConfirmed,
}: {
  /** Why the surface asks, in its own words. */
  hinweis: string;
  /** The code-by-mail half, `null` where the holder may confirm by passkey alone. */
  codeHalf: ReactNode;
  onConfirmed: () => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const [refused, setRefused] = useState(false);

  const bestaetige = async (): Promise<void> => {
    setIsPending(true);
    setRefused(false);
    try {
      const { error } = await authClient.signIn.passkey();
      if (error === null) {
        onConfirmed();
        return;
      }
      setRefused(true);
    } catch {
      // Thrown only by the options request, ahead of the ceremony; every later failure arrives on `error`.
      setRefused(true);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="muted-hint text-pretty">{hinweis}</p>

      <Button
        type="button"
        variant="primary"
        isPending={isPending}
        onPress={() => void bestaetige()}
        className={formButton({ intent: "submit", fullWidth: true })}>
        {isPending ? "Bestätigt..." : "Mit Passkey bestätigen"}
      </Button>

      {refused && (
        <p
          role="alert"
          className="fluid-sm text-pretty text-danger-strong">
          {NICHT_BESTAETIGT}
        </p>
      )}

      {codeHalf}
    </div>
  );
}
