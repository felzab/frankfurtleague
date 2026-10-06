import { austrittKuerzel, austrittZustand } from "../../constants";

import type { FLAustrittType } from "../../schemas";

/**
 * The two letters on screen and the whole state for a screen reader: an `aria-label` on a span with no role is one a
 * screen reader may ignore, which would leave it reading the letters alone.
 */
export function AustrittKuerzel({ type, className }: { type: FLAustrittType; className?: string }) {
  return (
    <span className={className}>
      <span aria-hidden="true">{austrittKuerzel(type)}</span>
      <span className="sr-only">{austrittZustand(type)}</span>
    </span>
  );
}
