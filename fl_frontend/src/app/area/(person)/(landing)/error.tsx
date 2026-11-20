"use client";

import { AreaError } from "../../AreaError";

/** The landing failed, in the rail frame its layout drew, which places the phone's band and bar around it. */
export default function LandingError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <AreaError
      error={error}
      retry={retry}
    />
  );
}
