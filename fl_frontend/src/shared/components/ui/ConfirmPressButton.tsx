"use client";

import { Button } from "@heroui/react";

import { confirmButton } from "./formButtons";
import { Hint } from "./Hint";

import type { ReactNode } from "react";

/**
 * The primary control of a two-press confirm: the refusal over it, the armed fill, the dropped glyph
 * and the three labels.
 *
 * Every clause below is `docs/frontend/spec.md` §1.14's, and twelve copies of it drift one at a time.
 */
export function ConfirmPressButton({
  isConfirming,
  isPending,
  reason,
  resting,
  armed,
  running,
  icon,
  onPress,
  type = "button",
  describedBy,
}: {
  isConfirming: boolean;
  /** The panel's own write in flight, which HOLDS the control rather than closing it (§1.14). */
  isPending: boolean;
  /** What closes the press, or `null` where nothing does. A running write lifts it: it ends by itself. */
  reason: string | null;
  resting: string;
  /** What the control says once the first press has armed it, which is also its name while armed. */
  armed: string;
  running: string;
  /** Shown at rest alone: the glyph announces the press, and step two announces itself in words. */
  icon: ReactNode;
  onPress?: () => void;
  /** `"submit"` for a panel whose press is its form's, which then carries no `onPress`. */
  type?: "button" | "submit";
  /** A hint the resting control is described by, dropped once armed: the armed label says it. */
  describedBy?: string;
}) {
  const label = isConfirming ? armed : resting;

  return (
    <Hint
      mode="refusal"
      reason={isPending ? null : reason}
      label={label}>
      <Button
        type={type}
        variant="primary"
        isPending={isPending}
        isDisabled={!isPending && reason !== null}
        onPress={onPress}
        aria-describedby={isConfirming ? undefined : describedBy}
        className={confirmButton(isConfirming)}>
        {!isConfirming && icon}
        {isPending ? running : label}
      </Button>
    </Hint>
  );
}
