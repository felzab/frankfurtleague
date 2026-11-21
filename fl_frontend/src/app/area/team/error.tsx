"use client";

import { RailColumn } from "@/kit/RailFrame";
import { RailError } from "@/kit/RailFrameBoundary";

/**
 * A failed team page in the rail frame: this boundary stands inside the frame's layout and replaces the route group's
 * column with the page, so it draws the phone's band and bar itself.
 */
export default function TeamError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailColumn>
      <RailError
        error={error}
        retry={retry}
        scope="area"
      />
    </RailColumn>
  );
}
