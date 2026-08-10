/**
 * TEAMS · why a team is out of this season
 *
 * The record as entered, and nothing when there is none — a team is disqualified exactly when the
 * field is not null (ADR-0047). `grund` is written for publication and reaches the reader as typed:
 * never mapped to a label, never shortened.
 *
 * Not a `Callout`: that component's three grades all describe what an admin's save is about to do,
 * and the only one that fits a standing public fact is tinted for information rather than for the
 * gravest thing this page states.
 */

import { formatSpielDatum } from "@/shared/utils/format";

import type { FLDisqualifikation } from "../../schemas";

export function TeamDisqualifikationNote({ disqualifikation }: { disqualifikation: FLDisqualifikation | null }) {
  if (disqualifikation === null) return null;

  return (
    // A landmark rather than a plain div: the note is the one thing on this page a reader may have
    // come for, and it sits between two sections that carry headings it must not be mistaken for.
    <section
      aria-label="Disqualifikation"
      className="border-danger/40 bg-danger/15 flex w-full flex-col gap-y-1.5 rounded-2xl border p-4 sm:p-6">
      {/* `-strong` on a `/15` tint, the pairing the accent tokens were measured at — the fill-grade
          accent does not carry text on this surface in the light theme. */}
      <strong className="fluid-xs text-danger-strong font-extrabold tracking-tight">
        Disqualifiziert seit {formatSpielDatum(disqualifikation.datum)}
      </strong>

      <p className="fluid-xs text-foreground font-medium text-pretty">{disqualifikation.grund}</p>
    </section>
  );
}
