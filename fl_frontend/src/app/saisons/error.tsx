"use client";

import { RailError } from "@/kit/RailFrameBoundary";

/** A public season page that failed, in the rail frame its layout drew: what happened, plainly, and a retry in place. */
export default function SaisonsError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailError
      error={error}
      retry={retry}
      scope="saison"
    />
  );
}
