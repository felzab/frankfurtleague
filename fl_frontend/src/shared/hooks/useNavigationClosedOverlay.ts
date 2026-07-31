"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Overlay open-state that closes itself when the route changes.
 *
 * react-aria overlays are uncontrolled by default and only light-dismiss on an outside interaction,
 * which a client-side navigation is not. Next then keeps the previous page mounted in a hidden
 * Activity tree, so the state survives: open a team popover, navigate away, come back, and it is
 * still open. Plain `<Link>`s inside a `Popover.Dialog` are the common case — react-aria has no
 * press hook on those, unlike its own `href` menu items.
 *
 * Callers pass the result to the overlay root's `isOpen` / `onOpenChange`, and should still close
 * explicitly on link press: that fires immediately, whereas this effect only runs once the new
 * pathname commits.
 */
export function useNavigationClosedOverlay(): { isOpen: boolean; setIsOpen: (open: boolean) => void } {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const openedAt = useRef(pathname);

  useEffect(() => {
    // Compared against the path the overlay was opened on, not run unconditionally: the effect
    // fires on mount too, and an unconditional close would fight the very first open.
    if (pathname !== openedAt.current) {
      openedAt.current = pathname;
      setIsOpen(false);
    }
  }, [pathname]);

  return { isOpen, setIsOpen };
}
