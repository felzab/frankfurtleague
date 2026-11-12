"use client";

import { AreaError } from "../../AreaError";

/** A pupil's page failed, in the rail frame its layout drew, which places the phone's band and bar around it. */
export default function SpielerError({ error }: { error: unknown }) {
  return <AreaError error={error} />;
}
