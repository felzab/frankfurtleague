"use client";

import { RailError } from "@/kit/RailFrameBoundary";

/**
 * A failed page of a referee's in the rail frame: this boundary stands inside the frame's layout, so the frame's band
 * and bar stand around it.
 */
export default function SchiedsrichterError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailError
      error={error}
      retry={retry}
      scope="area"
    />
  );
}
