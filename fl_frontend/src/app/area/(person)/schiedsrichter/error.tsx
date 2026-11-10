"use client";

import { RailColumn } from "@/kit/RailFrame";

import { AreaError } from "../../AreaError";

/**
 * A failed page of a referee's in the rail frame: this boundary stands inside the frame's layout and replaces the
 * route group's column with the page, so it draws the phone's band and bar itself.
 */
export default function SchiedsrichterError({ error }: { error: unknown }) {
  return (
    <RailColumn>
      <AreaError error={error} />
    </RailColumn>
  );
}
