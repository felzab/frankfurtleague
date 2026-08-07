"use client";

import { ArrowRightFromSquare, TriangleExclamation } from "@gravity-ui/icons";

import { useSignOut } from "@/shared/hooks/useSignOut";

import { IconTooltip } from "../../ui/IconTooltip";

import type { FormState } from "@/shared/types/types";

/**
 * Ends the admin's session, inline at the end of the bar.
 *
 * The behaviour is `useSignOut`'s and is shared with the sidemenu's options menu, which offers the
 * same control in a very different box (ADR-0058). What is this component's own is the compact shape
 * a 54px bar can hold: one glyph at rest, and a short prompt beside it once armed.
 *
 * **Escaping is deliberately easy** — moving focus away or pressing Escape disarms it. That is what
 * makes arming in place safe: the only path to signing out is a second, deliberate press on a control
 * that has visibly changed in three ways at once (label, tint, glyph), so it never rests on colour.
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
      // `onBlur` is the reliable disarm: arming leaves focus on this button, so anything else the
      // user does moves focus away from here.
      onBlur={disarm}
      onKeyDown={(event) => {
        if (event.key === "Escape") disarm();
      }}
      /* **One red at rest, one red when armed, and no hover step** (owner). The fill is there before
         the pointer arrives, because a control that only looks destructive on approach says nothing to
         a reader scanning the bar — and it does not brighten under the pointer, so the only thing that
         changes the colour is the state that matters. Armed also changes the label and the glyph, so
         the fill is never carrying that alone. */
      className={`text-danger flex h-9 shrink-0 items-center gap-x-2 rounded-md px-2 font-semibold transition-colors disabled:opacity-60 ${
        isConfirming ? "bg-danger/20" : "bg-danger/10"
      }`}>
      {isConfirming ? (
        <TriangleExclamation
          aria-hidden="true"
          className="size-[18px] shrink-0"
        />
      ) : (
        <ArrowRightFromSquare
          aria-hidden="true"
          className="size-[18px] shrink-0"
        />
      )}
      {/* Only while armed: the resting control is one glyph, so the bar stays quiet until it has a
          question to ask. */}
      {isConfirming && <span className="fluid-xs whitespace-nowrap">{isSigningOut ? "Wird abgemeldet..." : "Abmelden?"}</span>}
    </button>
  );

  // The tooltip names the resting control, whose glyph is its only label. Armed, the button says what
  // it is asking in visible text, so a tooltip would repeat it — and react-aria would announce it as
  // a description on top of the label that already changed.
  return isConfirming ? button : <IconTooltip label="Abmelden">{button}</IconTooltip>;
}
