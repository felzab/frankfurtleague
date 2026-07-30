"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Two-way binds a URL search param to a debounced local input. The URL stays the source of truth:
 * `urlValue` is what consumers filter on, `inputValue` is what the field displays.
 *
 * Replaces three copies of this effect pair, each of which carried its own `eslint-disable`
 * (R2 §3.2). The suppression is legitimate here and nowhere else: the sync effect exists precisely
 * to mirror external URL changes (browser back/forward) into local state.
 */
export function useDebouncedUrlQuery({ param = "q", delayMs = 300 }: { param?: string; delayMs?: number } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue = searchParams.get(param) || "";
  const [inputValue, setInputValue] = useState(urlValue);

  // Sync local input if the URL changes externally (e.g. browser back/forward buttons)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(urlValue);
  }, [urlValue]);

  // Debouncing logic (updates the URL lazily after `delayMs`)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (urlValue === inputValue) return;

      const params = new URLSearchParams(searchParams);
      if (inputValue) {
        params.set(param, inputValue);
      } else {
        params.delete(param);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [inputValue, urlValue, param, delayMs, router, pathname, searchParams]);

  return { urlValue, inputValue, setInputValue };
}
