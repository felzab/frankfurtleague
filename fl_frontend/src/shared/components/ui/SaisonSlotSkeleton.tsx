import { skeletonBlock } from "./skeleton";

/**
 * The placeholder that stands in for the sidemenu's season selector.
 *
 * Used twice, and both matter:
 * - as `Sidemenu`'s `Suspense` fallback, while `SaisonMetadataDisplay` fetches on the server;
 * - by `SaisonSelector` itself, until it has hydrated.
 *
 * The second is the non-obvious one. The selector streams in as real, styled markup well before
 * React attaches to it, so without this there is a window where the control looks completely ready
 * and does nothing at all when pressed. Keeping the placeholder until the selector is live means the
 * user only ever sees a control that works — and the transition is the one they were already
 * watching, not a new one.
 *
 * **It mirrors `SaisonSelector`'s trigger rather than guessing at it.** This was a flat `h-[70px]`
 * slab, and 70px was a guess: the real trigger has no fixed height at all. It is `min-h-14` plus a
 * `text-fluid-lg` name over a `text-fluid-xxs` timespan, so it measures ~65px at a phone width and
 * ~71px at a desktop one, and the slab was several pixels out at both ends. Reusing the trigger's own
 * shell classes and letting the same two text runs set the height removes the guess entirely.
 *
 * It carries no text, so it needs the labelled status region or a screen-reader user gets silence
 * while it waits.
 */
export function SaisonSlotSkeleton() {
  return (
    <div
      role="status"
      aria-label="Saisonauswahl wird geladen"
      className="border-border/60 bg-surface/50 flex min-h-14 w-full flex-row items-center justify-between rounded-xl border px-4 py-2.5 shadow-xs">
      {/* `gap-0.5` and `text-fluid-lg` are the trigger's own — see the note above.
          The timespan bar is `text-xs`, NOT the `text-fluid-xxs` the trigger asks for, and that is
          matching reality rather than intent: HeroUI's `Description` merges its own classes with
          tailwind-merge, which is not told about this app's `--text-fluid-*` scale (the hazard
          `shared/utils/tv.ts` exists to close, and it cannot reach inside a library's merge). It
          therefore files `text-fluid-xxs` as a COLOUR, in the same conflict group as
          `text-foreground-muted`, and drops it — measured in the browser, the rendered element's
          class list has no `fluid` class at all and it computes to `text-xs`'s 12px/16px. Matching
          the fluid class here made this placeholder 2.9px too tall. If the trigger is ever changed
          to render a plain span, this goes back to `text-fluid-xxs` in the same commit. */}
      <div className="flex flex-col gap-0.5">
        <span className={`${skeletonBlock()} text-fluid-lg block w-28 rounded-md`}>&nbsp;</span>
        <span className={`${skeletonBlock()} block w-36 rounded text-xs`}>&nbsp;</span>
      </div>

      {/* The chevron's silhouette. `Select.Indicator` renders an 16px icon at the trigger's end. */}
      <span className={`${skeletonBlock()} size-4 shrink-0 rounded`} />
    </div>
  );
}
