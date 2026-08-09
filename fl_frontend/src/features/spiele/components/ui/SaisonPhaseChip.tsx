import { Chip } from "@heroui/react";

import { PHASE_LABELS } from "@/features/saisons/constants";

import type { FLSaisonPhase } from "@/features/saisons/schemas";

// See SpielStatusChip for why all three maps live at module scope. This one mattered more: the icon
// map allocates five <svg> elements and would rebuild all of them on every render to use one.
// The tint is the label colour at 10%, not 15%: one token has to serve both roles here, and at /15
// the deeper tint pulled `gruppenphase` and `finale` to 4.39:1 and 4.46:1 in the light theme —
// below AA, and below what the two-value raw-palette version managed. /10 restores 4.72 and 4.87.
const PHASE_CLASSES: Record<FLSaisonPhase, string> = {
  gruppenphase: "bg-phase-gruppenphase/10 text-phase-gruppenphase",
  achtelfinale: "bg-phase-achtelfinale/10 text-phase-achtelfinale",
  viertelfinale: "bg-phase-viertelfinale/10 text-phase-viertelfinale",
  halbfinale: "bg-phase-halbfinale/10 text-phase-halbfinale",
  finale: "bg-phase-finale/10 text-phase-finale",
};

const PHASE_ICONS: Record<FLSaisonPhase, React.ReactElement> = {
  gruppenphase: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <rect
        x="4"
        y="4"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="14"
        y="4"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="4"
        y="14"
        width="6"
        height="6"
        rx="1"
      />
      <rect
        x="14"
        y="14"
        width="6"
        height="6"
        rx="1"
      />
    </svg>
  ),
  // Four pair-brackets narrowing to one line, against `viertelfinale`'s two below. A thinner stroke
  // because eight entry arms in a 24-unit box cannot carry 2: what has to survive at 14px is the
  // SILHOUETTE — a busy left edge collapsing to a single output — and the German label sits beside it.
  achtelfinale: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M3 1.5h3v3H3" />
      <path d="M3 7.5h3v3H3" />
      <path d="M3 13.5h3v3H3" />
      <path d="M3 19.5h3v3H3" />
      <path d="M6 3h2" />
      <path d="M6 9h2" />
      <path d="M6 15h2" />
      <path d="M6 21h2" />
      <path d="M8 3v6" />
      <path d="M8 15v6" />
      <path d="M8 6h3" />
      <path d="M8 18h3" />
      <path d="M11 6v12" />
      <path d="M11 12h4" />
    </svg>
  ),
  viertelfinale: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M4 4h4v5H4" />
      <path d="M8 6.5h4" />
      <path d="M4 15h4v5H4" />
      <path d="M8 17.5h4" />
      <path d="M12 6.5v11" />
      <path d="M12 12h6" />
    </svg>
  ),
  halbfinale: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M6 6h5v12H6" />
      <path d="M11 12h7" />
      <circle
        cx="19"
        cy="12"
        r="2"
      />
    </svg>
  ),
  finale: (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round">
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10l-1 9c0 3-4 4-4 4s-4-1-4-4L7 4z" />
      <path d="M7 7H5a2 2 0 0 1 0-4h2" />
      <path d="M17 7h2a2 2 0 0 0 0-4h-2" />
    </svg>
  ),
};

export function SaisonPhaseChip({ saisonPhase }: { saisonPhase: FLSaisonPhase }) {
  return (
    <Chip
      size="sm"
      /* `rounded-md` overrides HeroUI's `rounded-2xl` on `.chip` (decided 2026-08-07) — one radius for
         every pill in the app, matching `SpielStatusChip` beside it and the badge recipes in
         `shared/components/ui/badges.ts`. A utility beats the component layer, so no `!` is needed. */
      className={`rounded-md border-none px-1.5 py-0.5 ${PHASE_CLASSES[saisonPhase]}`}>
      <div className="fluid-xxs flex items-center gap-1 font-extrabold tracking-wide uppercase">
        {PHASE_ICONS[saisonPhase]}
        {PHASE_LABELS[saisonPhase]}
      </div>
    </Chip>
  );
}
