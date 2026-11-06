import { useLayoutEffect, useRef, useState } from "react";

/** An overlay's open state as another control holds it, such as a combo box's create entry. */
export type HeldOpen = { isOpen: boolean; onOpenChange: (isOpen: boolean) => void };

/**
 * An overlay's open state, closed whenever Next hides the page it stands on: Next keeps a departed route
 * in a hidden `Activity`, and a menu or dialog found open on the way back is stale. Closing in a layout
 * effect's cleanup is the reset Next's guide to preserving UI state gives for transient overlays. Given the
 * state another control holds, it closes that one through its setter, so the overlay closes whatever kind of
 * state its holder keeps; an overlay mounted already open is closed by React's strict mode in development,
 * which runs that cleanup once on mount, so a holder mounts the overlay closed and opens it by the state.
 */
export function useOpenUntilHidden(held?: HeldOpen) {
  const [own, setOwn] = useState(false);
  const isOpen = held?.isOpen ?? own;
  const setOpen = held?.onOpenChange ?? setOwn;
  // The cleanup runs once, with the setter of the last render: a holder may pass a new one on every render.
  const close = useRef(setOpen);
  useLayoutEffect(() => {
    close.current = setOpen;
  });
  useLayoutEffect(() => () => close.current(false), []);
  return [isOpen, setOpen] as const;
}
