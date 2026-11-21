"use client";

import { RailColumn } from "@/kit/RailFrame";
import { RailError } from "@/kit/RailFrameBoundary";

/**
 * A failed page of the administration, an unread grant among its failures, in the rail frame: this boundary stands
 * inside the frame's layout and replaces the route group's column with the page, so it draws the phone's band
 * and bar itself.
 */
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
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
