import { formatSpielDatum } from "@/shared/utils/format";

import type { FLDisqualifikation } from "../../schemas";

/** Not a `Callout`: those grades describe what a save is about to do, not a standing public fact. */
export function TeamDisqualifikationNote({ disqualifikation }: { disqualifikation: FLDisqualifikation | null }) {
  if (disqualifikation === null) return null;

  return (
    // A landmark rather than a plain div: it sits among sections carrying headings it must not be
    // mistaken for.
    <section
      aria-label="Disqualifikation"
      className="border-danger/40 bg-danger/15 flex w-full flex-col gap-y-1.5 rounded-2xl border p-4 sm:p-6">
      {/* `-strong` on a `/15` tint, the pairing the accent tokens were measured at. */}
      <strong className="fluid-xs text-danger-strong font-extrabold tracking-tight">
        Disqualifiziert seit {formatSpielDatum(disqualifikation.datum)}
      </strong>

      <p className="fluid-xs text-foreground font-medium text-pretty">{disqualifikation.grund}</p>
    </section>
  );
}
