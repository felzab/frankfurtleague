import { DISPLAY_HEADING, WORDMARK } from "./displayType";
import { FLLogo } from "./FLLogo";

/**
 * A meta page's one brand block. Nothing in it is focusable: `--focus` is `--fg-base`, which is
 * near-black in the light theme and invisible on this fill.
 */
export function BrandHero({ title, lead }: { title: string; lead: string }) {
  return (
    <header className="bg-brand-solid text-brand-solid-foreground border-brand-solid-foreground/15 relative flex w-full flex-row items-start gap-x-5 overflow-hidden rounded-3xl border px-4 py-6 shadow-sm sm:gap-x-8 sm:p-8 lg:items-center lg:p-10">
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

      <FLLogo className="text-brand-solid-accent relative h-20 w-auto shrink-0 sm:h-28 lg:h-40" />
    </header>
  );
}

/**
 * A trace inside the block rather than a ground behind the page: it reads as football without
 * competing with the title. The alpha is an attribute and not a class, so it needs no token.
 */
function PitchTrace() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      fill="none"
      stroke="currentColor"
      strokeOpacity={0.13}
      strokeWidth={2}
      className="pointer-events-none absolute -top-[30%] -right-[4%] aspect-square h-[160%]">
      {/* `non-scaling-stroke` on each shape, because the SVG is sized off the block: without it the
          stroke thickens with the hero's own height instead of staying a drawn line. */}
      <line
        x1="60"
        y1="0"
        x2="60"
        y2="200"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="60"
        cy="100"
        r="42"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="60"
        cy="100"
        r="2.5"
        fill="currentColor"
        fillOpacity={0.13}
        stroke="none"
      />
      <path
        d="M200 40H150V160H200"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
