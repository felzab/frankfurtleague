import { DISPLAY_HEADING, WORDMARK } from "./displayType";
import { FLLogo } from "./FLLogo";

/**
 * A meta page's one brand block. Nothing in it is focusable: `--focus` is `--fg-base`, which is
 * near-black in the light theme and invisible on this fill.
 */
export function BrandHero({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="bg-brand-solid text-brand-solid-foreground border-brand-solid-foreground/15 relative flex w-full flex-row items-center gap-x-5 overflow-hidden rounded-3xl border px-4 py-6 shadow-sm sm:gap-x-8 sm:p-8 lg:p-10">
      <PitchTrace />

      <div className="relative flex min-w-0 flex-1 flex-col gap-y-3">
        {/* `aria-hidden` because the navbar's wordmark is the link a reader is given the name by. */}
        <span
          aria-hidden="true"
          className={`${WORDMARK} fluid-sm text-brand-solid-accent`}>
          Frankfurt League
        </span>
        <h1 className={`${DISPLAY_HEADING} fluid-4xl text-balance`}>{title}</h1>
        <p className="fluid-lg text-brand-solid-foreground/85 max-w-2xl font-medium text-pretty">{lead}</p>
      </div>

      {/* `relative`, so the mark stacks over the trace rather than under it. */}
      <FLLogo className="text-brand-solid-accent relative h-20 w-auto shrink-0 sm:h-28 lg:h-40" />
    </header>
  );
}

// Shared by both ends, so one scale governs the drawing: a marking is the same size at either edge.
const PITCH_LINE = "pointer-events-none absolute top-0 h-full w-auto";

/**
 * The two ends of one half pitch, each pinned to the block's own edge: the block is far wider than
 * a half pitch, so drawing it whole leaves the centre circle a detail.
 */
function PitchTrace() {
  return (
    <>
      {/* The block's left edge IS the halfway line, so the circle springs from it as a semicircle
          and the centre spot sits on it. Drawing the line as well would double the edge. */}
      <svg
        aria-hidden="true"
        viewBox="0 -15 10 30"
        preserveAspectRatio="xMinYMid meet"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.13}
        strokeWidth={2}
        className={`${PITCH_LINE} left-0 max-w-[38%]`}>
        {/* `non-scaling-stroke` on every stroked shape, because the drawing is sized off the block:
            without it the stroke thickens with the hero's height instead of staying a drawn line. */}
        <circle
          cx="0"
          cy="0"
          r="9.15"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="0"
          cy="0"
          r="0.55"
          fill="currentColor"
          fillOpacity={0.13}
          stroke="none"
        />
      </svg>

      {/* The goal end, and the block's right edge IS the goal line, as its left edge is the halfway
          line. The penalty area is wider than the frame is tall, so its sides leave the block. */}
      <svg
        aria-hidden="true"
        viewBox="-21 -15 21 30"
        preserveAspectRatio="xMaxYMid meet"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.13}
        strokeWidth={2}
        className={`${PITCH_LINE} right-0 max-w-[62%]`}>
        <path
          d="M0 -20.16H-16.5V20.16H0"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 -9.16H-5.5V9.16H0"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx="-11"
          cy="0"
          r="0.55"
          fill="currentColor"
          fillOpacity={0.13}
          stroke="none"
        />
        <path
          d="M-16.5 -7.3125A9.15 9.15 0 0 0 -16.5 7.3125"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </>
  );
}
