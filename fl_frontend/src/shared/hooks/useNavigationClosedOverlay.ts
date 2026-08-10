"use client";

/**
 * SHARED · route-closed overlay
 *
 * Overlay open-state that closes itself when the route changes. It exists because a client-side
 * navigation is not an outside interaction, so react-aria's light dismiss never fires, and Next keeps
 * the previous page mounted in a hidden Activity tree — an overlay left open is still open on return.
 *
 * Callers should *also* close explicitly on link press: that is immediate, whereas this effect only
 * runs once the new pathname commits.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Plain `<Link>`s inside a `Popover.Dialog` are the case this exists for: react-aria has no press
 * hook on those, unlike its own `href` menu items. The result goes to the overlay root's
 * `isOpen` / `onOpenChange`.
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
