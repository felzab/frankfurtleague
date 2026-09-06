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

      {/* `TRACE_INSET` is derived from these three heights and the block's padding; a change to
          either moves it too. */}
      <FLLogo className="text-brand-solid-accent relative h-20 w-auto shrink-0 sm:h-28 lg:h-40" />
    </header>
  );
}

// The block's padding plus the mark's width at `h-20`, `h-28` and `h-40`, floored to the spacing
// step, which leaves about 17px of air at each.
const TRACE_INSET = "right-15 sm:right-22 lg:right-28";

/**
 * A trace inside the block rather than a ground behind the page: it reads as football without
 * competing with the title. The alpha is an attribute and not a class, so it needs no token.
 */
function PitchTrace() {
  return (
    <svg
      aria-hidden="true"
      // Metres, with the origin at the goal line's centre, so every marking is the Laws of the Game's
      // own figure. The frame is not: it crops a 68m pitch to 52m, having no touchline to draw.
      viewBox="-63.65 -26 67.09 52"
      fill="none"
      stroke="currentColor"
      strokeOpacity={0.13}
      strokeWidth={2}
      // Sized off the block's height, because its width runs from little more than its height to
      // over four times it: a drawing filling the width loses the penalty area's top and bottom on
      // the wide end.
      className={`pointer-events-none absolute top-0 h-full w-auto ${TRACE_INSET}`}>
      {/* `non-scaling-stroke` on every stroked shape, because the SVG is sized off the block: without
          it the stroke thickens with the hero's own height instead of staying a drawn line. */}
      <line
        x1="-52.5"
        y1="-26"
        x2="-52.5"
        y2="26"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="-52.5"
        cy="0"
        r="9.15"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="-52.5"
        cy="0"
        r="0.55"
        fill="currentColor"
        fillOpacity={0.13}
        stroke="none"
      />
      <line
        x1="0"
        y1="-26"
        x2="0"
        y2="26"
        vectorEffect="non-scaling-stroke"
      />
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
        d="M-16.5 -7.31A9.15 9.15 0 0 0 -16.5 7.31"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 -3.66H2.44V3.66H0"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
