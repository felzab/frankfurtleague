"use client";

/**
 * SHARED · debounced URL query
 *
 * The one implementation of "type into a box, filter from the URL". It replaced three copies
 * that had each grown their own `eslint-disable`.
 *
 * Invariants:
 * - The URL is the source of truth — filtering on the input instead breaks back/forward.
 * - The hook's own writes are skipped by the sync effect, or a slow commit rewinds the field.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Two-way binds a URL search param to a debounced local input. The URL stays the source of truth:
 * `urlValue` is what consumers filter on, `inputValue` is what the field displays.
 *
 * Replaces three copies of this effect pair, each of which carried its own `eslint-disable`.
 * The suppression is legitimate here and nowhere else: the sync effect exists precisely
 * to mirror external URL changes (browser back/forward) into local state.
 */
export function useDebouncedUrlQuery({ param = "q", delayMs = 300 }: { param?: string; delayMs?: number } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlValue = searchParams.get(param) || "";
  const [inputValue, setInputValue] = useState(urlValue);

  // The last value this hook itself wrote to the URL. A `router.replace` on a route that awaits
  // the request commits hundreds of ms later, by which time the user has usually typed more; without
  // this guard the sync effect below would then rewind the field to the stale value and eat those
  // keystrokes. Own writes are recognised and skipped; genuinely external changes still sync.
  const lastWritten = useRef<string | null>(null);

  // Sync local input if the URL changes externally (e.g. browser back/forward buttons)
  useEffect(() => {
    if (urlValue === lastWritten.current) return;
    lastWritten.current = null;
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
      lastWritten.current = inputValue;
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [inputValue, urlValue, param, delayMs, router, pathname, searchParams]);

  return { urlValue, inputValue, setInputValue };
}
