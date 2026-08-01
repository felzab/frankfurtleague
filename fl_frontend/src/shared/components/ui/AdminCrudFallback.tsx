import { card } from "./card";

/** Header cells are label-width, body cells are content-width — enough variation to read as a table. */
const HEADER_CELL_WIDTHS = ["w-28", "w-24", "w-32", "w-20", "w-16"];
const BODY_CELL_WIDTHS = ["w-40", "w-36", "w-44", "w-28", "w-10"];

/**
 * What an admin CRUD page shows while its rows are in flight.
 *
 * **Everything here is inert on purpose.** It used to render the real `SearchBar`, wired to a `noop`
 * — a finished-looking control that silently swallowed anything typed into it. That is precisely the
 * defect NEW-R6 diagnosed on the saison selector and fixed by *not showing a control until it works*;
 * shipping the fix and the anti-pattern in one wave would have been silly. The field is now a shape,
 * not a control, so there is nothing to type into and nothing to lose. It also means this needs no
 * `"use client"`: with no `onChange` to hand down, it is a plain server component.
 *
 * **It must not call a request-dynamic hook** either, if that ever changes — this is a `Suspense`
 * fallback, and a fallback that reaches for `useSearchParams` (directly or through
 * `useDebouncedUrlQuery`) suspends too, pushing the bailout back up to the boundary above and undoing
 * NEW-SC10/SC11.
 *
 * **Three things stop it reading as a flicker (NEW-R5).**
 *
 * First — and this is the one that actually mattered — whatever replaces it animates in rather than
 * appearing. `AdminCrudView` now carries the app's standard entrance, so the hand-over is a movement
 * instead of a snap. A same-shaped skeleton was only ever half the problem.
 *
 * Second, it is invisible unless the wait is real. `delay-200 fill-mode-both` applies the `enter`
 * keyframe's opening state — `opacity: 0`, from `fade-in` — for the first 200 ms, so a navigation
 * whose data is already cached server-side swaps straight to the table and this is never painted.
 * Checked in the built CSS, not just the plugin source: `delay-200` emits **two** rules — Tailwind
 * core's `transition-delay` and `tw-animate-css`'s `animation-delay`. They set different
 * properties, so both apply and the animation delay is real; the transition one is inert here.
 *
 * Third, it is the same shape as what replaces it. It was five bare 56px bars in a plain column, so
 * the swap to a bordered card with a header strip visibly resized the page. It now mirrors
 * `AdminSchiedsrichterTable` / `AdminSpielorteTable`: the same `card()` shell, a `bg-muted` header
 * strip with a bottom border, and rows on the same `px-6 py-4` rhythm.
 */
export function AdminCrudFallback() {
  return (
    <div
      role="status"
      aria-label="Daten werden geladen"
      className="animate-in fade-in fill-mode-both flex flex-col gap-8 delay-200 duration-150">
      {/* The search field's silhouette — same height, radius, border and width cap as `SearchBar`. */}
      <div className="bg-surface border-border h-12 w-full max-w-md rounded-xl border shadow-sm lg:h-15" />

      <div className={`${card()} h-fit w-full overflow-hidden p-0`}>
        <div className="bg-muted border-border flex items-center gap-6 border-b px-6 py-4">
          {HEADER_CELL_WIDTHS.map((width) => (
            <div
              key={width}
              className={`bg-foreground-muted/25 h-3 rounded ${width}`}
            />
          ))}
        </div>

        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="border-border/50 flex items-center gap-6 border-b px-6 py-4 last:border-b-0">
            {BODY_CELL_WIDTHS.map((width) => (
              <div
                key={width}
                className={`bg-muted h-4 animate-pulse rounded ${width}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
