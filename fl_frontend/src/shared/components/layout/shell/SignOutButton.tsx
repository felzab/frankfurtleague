"use client";

import { ArrowRightFromSquare } from "@gravity-ui/icons";

import { useSignOut } from "@/shared/hooks/useSignOut";

import { IconTooltip } from "../../ui/IconTooltip";

import type { FormState } from "@/shared/types/types";

/**
 * **Escaping is deliberately easy** — moving focus away or pressing Escape disarms it — which is what makes arming in
 * place safe. The behaviour is `useSignOut`'s; only the compact shape is this component's own.
 */
export function SignOutButton({ onSignOut }: { onSignOut: () => Promise<FormState> }) {
  const { isConfirming, isSigningOut, press, disarm } = useSignOut(onSignOut);

  const button = (
    <button
      type="button"
      disabled={isSigningOut}
      aria-label={isConfirming ? "Abmelden?" : "Abmelden"}
      data-signout-control="true"
      onClick={press}
      // Arming leaves focus on this button, so anything else the user does moves focus away from here.
      onBlur={disarm}
      onKeyDown={(event) => {
        if (event.key === "Escape") disarm();
      }}
      /* One red at rest and one when armed, with no hover step: a control that only looks destructive on
         approach says nothing to a reader scanning the bar. */
      className={`text-danger flex h-9 shrink-0 items-center justify-center rounded-md font-semibold transition-colors disabled:opacity-60 ${
        isConfirming ? "bg-danger/20 px-3" : "bg-danger/10 px-2"
      }`}>
      {/* Armed, the control is its question and nothing else; at rest it is the one glyph, so the bar stays quiet. */}
      {isConfirming ? (
        <span className="fluid-sm whitespace-nowrap">{isSigningOut ? "Wird abgemeldet..." : "Abmelden?"}</span>
      ) : (
        <ArrowRightFromSquare
          aria-hidden="true"
          className="size-[18px] shrink-0"
        />
      )}
    </button>
  );

  // The tooltip names the resting control, whose glyph is its only label. Armed, the button already says it
  // in visible text, so a tooltip would repeat it.
  return isConfirming ? button : <IconTooltip label="Abmelden">{button}</IconTooltip>;
}
