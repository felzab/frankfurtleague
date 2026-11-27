"use client";

import { RailError } from "@/kit/RailFrameBoundary";

/**
 * A failed team page in the rail frame: this boundary stands inside the frame's layout, so the frame's band and bar
 * stand around it.
 */
export default function TeamError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailError
      error={error}
      retry={retry}
      scope="area"
    />
  );
}
