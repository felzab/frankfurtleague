import { tv } from "tailwind-variants";

const contentLoader = tv({
  base: "flex w-full flex-1 items-center justify-center gap-x-1.5 px-4 py-16",
  variants: {
    /**
     * Which box the dots are asked to fill. `region` is any ground whose own height already ends
     * where the loader should.
     */
    fills: {
      region: "",
      /* `flex-1` stretches only to the viewport MINUS the site footer, which then sits on screen for
         the whole load. `dvh`, not `vh`: on a phone `vh` is the chrome-hidden height and overshoots. */
      /* NEVER under `AppShell` — that shell is `h-dvh` around its own scroller, so a viewport-tall
         child there scrolls the region by the navbar's height instead. */
      viewport: "min-h-[calc(100dvh-var(--navbar-height))]",
    },
  },
  defaultVariants: { fills: "region" },
});

/**
 * Deliberately a different shape from `PageLoader`'s ringed spinner, so the two are tellable at a glance: that one means
 * a whole page is loading, this that the shell is painted and only the content region is streaming.
 */
export function ContentLoader({ fills }: { fills?: "region" | "viewport" } = {}) {
  return (
    <div
      role="status"
      aria-label="Inhalte werden geladen"
      className={contentLoader({ fills })}>
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.4s]" />
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full [animation-delay:-0.2s]" />
      <span className="bg-brand-solid animate-loader-dot size-2.5 rounded-full" />
    </div>
  );
}
