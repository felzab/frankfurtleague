"use client";

import { RailColumn } from "@/kit/RailFrame";

import { AreaError } from "../AreaError";

/**
 * A failed team page in the rail frame: this boundary stands inside the frame's layout and replaces the route group's
 * column with the page, so it draws the phone's band and bar itself.
 */
export default function TeamError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailColumn>
      <AreaError
        error={error}
        retry={retry}
      />
    </RailColumn>
  );
}
