"use client";

import { RailError } from "@/kit/RailFrameBoundary";

/** A pupil's page failed, in the rail frame its layout drew, which places the phone's band and bar around it. */
export default function SpielerError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <RailError
      error={error}
      retry={retry}
      scope="area"
    />
  );
}
