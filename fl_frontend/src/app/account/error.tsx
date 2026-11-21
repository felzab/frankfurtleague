"use client";

import { ROUTES } from "@/core/routes";
import { RailColumn } from "@/kit/RailFrame";
import { RailError } from "@/kit/RailFrameBoundary";

/**
 * A failed Konto page in the rail frame: this boundary stands inside the frame's layout and replaces the route group's
 * column with the page, so it draws the phone's band itself, leading back to the list of Konto's pages, which reads
 * nothing but the session.
 */
export default function AccountError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailColumn back={ROUTES.account.path()}>
      <RailError
        error={error}
        retry={retry}
        scope="area"
      />
    </RailColumn>
  );
}
