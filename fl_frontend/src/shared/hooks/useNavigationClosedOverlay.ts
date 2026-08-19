"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Closes an overlay on a route change, a client-side navigation not being an outside interaction. **It cannot reach one
 * living inside a page**: the departed page is hidden rather than unmounted, and React destroys its Effects.
 */
export function useNavigationClosedOverlay(): { isOpen: boolean; setIsOpen: (open: boolean) => void } {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const openedAt = useRef(pathname);

  useEffect(() => {
    // Compared against the path it was opened on: the effect fires on mount too, and an unconditional
    // close would fight the very first open.
    if (pathname !== openedAt.current) {
      openedAt.current = pathname;
      setIsOpen(false);
    }
  }, [pathname]);

  return { isOpen, setIsOpen };
}
