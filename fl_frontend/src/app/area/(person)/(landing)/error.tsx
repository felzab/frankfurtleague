"use client";

import { AreaError } from "../../AreaError";

/** The landing failed, in the rail frame its layout drew, which places the phone's band and bar around it. */
export default function LandingError({ error }: { error: unknown }) {
  return <AreaError error={error} />;
}
