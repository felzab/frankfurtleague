"use client";

import { RailError } from "@/kit/RailFrameBoundary";

/**
 * A failed Konto page in the rail frame: this boundary stands inside the frame's layout, so the frame's band stands
 * around it, leading back from one of Konto's pages to the list of them, which reads nothing but the session.
 */
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailError
      error={error}
      retry={retry}
      scope="area"
    />
  );
}
