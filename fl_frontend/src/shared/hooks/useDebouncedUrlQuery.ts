"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { QUERY_PARAM, useUrlQuery } from "./useUrlQuery";

/**
 * Two-way binds a URL search param to a debounced input. The URL stays the source of truth — filtering on the input
 * breaks back and forward — so `urlValue` is what consumers filter on and `inputValue` what the field displays.
 */
export function useDebouncedUrlQuery({ param = QUERY_PARAM, delayMs = 300 }: { param?: string; delayMs?: number } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue = useUrlQuery(param);
  const [inputValue, setInputValue] = useState(urlValue);

  // The last value this hook wrote. A `router.replace` commits hundreds of ms later, and without this
  // guard the sync effect below rewinds the field to the stale value and eats the keystrokes since.
  const lastWritten = useRef<string | null>(null);

  // Mirrors an external URL change — browser back/forward — into the field.
  useEffect(() => {
    if (urlValue === lastWritten.current) return;
    lastWritten.current = null;
    setInputValue(urlValue);
  }, [urlValue]);

  // Written lazily: a `router.replace` per keystroke is one navigation per keystroke on a route that awaits the request.
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
