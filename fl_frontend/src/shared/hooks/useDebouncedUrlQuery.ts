"use client";

/**
 * SHARED · debounced URL query
 *
 * The one implementation of "type into a box, filter from the URL".
 *
 * Invariants:
 * - The URL is the source of truth — filtering on the input instead breaks back/forward.
 * - The hook's own writes are skipped by the sync effect, or a slow commit rewinds the field.
 * - The read of the parameter is `useUrlQuery`'s, so a field and a list can never disagree about
 *   what an absent or empty `?q=` means.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { QUERY_PARAM, useUrlQuery } from "./useUrlQuery";

/**
 * Two-way binds a URL search param to a debounced local input, for the component that renders the
 * field. The URL stays the source of truth: `urlValue` is what consumers filter on, `inputValue` is
 * what the field displays. A component that only reads the parameter takes `useUrlQuery` instead.
 */
export function useDebouncedUrlQuery({ param = QUERY_PARAM, delayMs = 300 }: { param?: string; delayMs?: number } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue = useUrlQuery(param);
  const [inputValue, setInputValue] = useState(urlValue);

  // The last value this hook wrote to the URL. A `router.replace` commits hundreds of ms later, by
  // which time the user has usually typed more; without this guard the sync effect below rewinds the
  // field to the stale value and eats those keystrokes.
  const lastWritten = useRef<string | null>(null);

  // Mirrors an external URL change -- browser back/forward -- back into the field.
  useEffect(() => {
    if (urlValue === lastWritten.current) return;
    lastWritten.current = null;
    setInputValue(urlValue);
  }, [urlValue]);

  // The URL is written lazily, after `delayMs`: a `router.replace` per keystroke is one navigation
  // per keystroke on a route that awaits the request.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (urlValue === inputValue) return;

      const params = new URLSearchParams(searchParams);
      if (inputValue) {
        params.set(param, inputValue);
      } else {
        params.delete(param);
      }
      lastWritten.current = inputValue;
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [inputValue, urlValue, param, delayMs, router, pathname, searchParams]);

  return { urlValue, inputValue, setInputValue };
}
