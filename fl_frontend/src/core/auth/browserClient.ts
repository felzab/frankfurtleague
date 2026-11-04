import { useEffect } from "react";

import type { authClient } from "../authClient";

/**
 * The library's browser client, in a chunk of its own off every page's first load: Next's documented lazy loading of
 * an external library, an `import()` where it is used. Every press needing the client awaits this one import, which
 * the lint rule against `import()` spares by this file alone.
 */
export async function loadAuthClient(): Promise<typeof authClient> {
  return (await import("@/core/authClient")).authClient;
}

/**
 * Fetches the client once the page stands, so a press then awaits a module already here and a passkey prompt keeps
 * the gesture that asked for it; `when` false fetches nothing. A fetch that failed here is the press's to answer,
 * which asks again.
 */
export function usePreloadedAuthClient(when = true): void {
  useEffect(() => {
    if (when) void loadAuthClient().catch(() => undefined);
  }, [when]);
}
