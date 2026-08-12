"use client";

/**
 * SHARED · route-closed overlay
 *
 * Overlay open-state that closes itself when the route changes. It exists because a client-side
 * navigation is not an outside interaction, so react-aria's light dismiss never fires, and Next keeps
 * the previous page mounted in a hidden Activity tree — an overlay left open is still open on return.
 *
 * The effect below reaches an overlay the router keeps mounted across a navigation — one the sidemenu
 * renders, say. It cannot reach one that lives inside a page: the departed page is hidden rather than
 * unmounted, and React destroys a hidden subtree's Effects, so nothing inside it ever observes the new
 * pathname. Such a caller closes as its own link navigates, and that press is the whole of its closing
 * rather than the immediate half.
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
