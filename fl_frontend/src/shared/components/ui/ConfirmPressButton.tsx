"use client";

import { Button } from "@heroui/react/button";

import { confirmButton } from "./formButtons";
import { Hint } from "./Hint";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { ReactNode } from "react";

/**
 * The primary control of a two-press confirm: the refusal over it, the armed fill, the dropped glyph
 * and the three labels — every clause `docs/frontend/spec.md` §1.14's, and a panel spelling them out
 * drifts from that one clause at a time.
 */
export function ConfirmPressButton({
  confirm,
  submitting = false,
  held = false,
  reason,
  resting,
  armed,
  running,
  icon,
  onPress,
  type = "button",
  describedBy,
}: {
  confirm: TwoPressConfirm;
  /**
   * A one-press write this control starts at rest, the form's own submit, which runs outside the hook
   * and so is never in its `isPending`. Shown as `running`, as the hook's write is.
   */
  submitting?: boolean;
  /**
   * Held for something that is NOT the write — an arming read the press waits on. Pending-marked as a
   * write is, and the label untouched: `running` names a write nobody has started.
   */
  held?: boolean;
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
  const { isConfirming } = confirm;
  const label = isConfirming ? armed : resting;
  const writing = confirm.isPending || submitting;
  // A write in flight HOLDS the control rather than closing it (§1.14).
  const waiting = writing || held;

  return (
    <Hint
      mode="refusal"
      reason={waiting ? null : reason}
      label={label}>
      <Button
        type={type}
        variant="primary"
        isPending={waiting}
        isDisabled={!waiting && reason !== null}
        onPress={onPress}
        aria-describedby={isConfirming ? undefined : describedBy}
        className={confirmButton(isConfirming)}>
        {!isConfirming && icon}
        {writing ? running : label}
      </Button>
    </Hint>
  );
}
