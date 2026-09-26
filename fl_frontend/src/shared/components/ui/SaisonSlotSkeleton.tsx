import { skeletonBlock } from "./skeleton";

/**
 * Stands in for the season selector, including inside `SaisonSelector` until it hydrates: the real control streams in as
 * styled markup before React attaches. It mirrors the real trigger's own classes, and its bar widths are in `em`.
 */
export function SaisonSlotSkeleton() {
  return (
    <div
      role="status"
      // `relative`, because the chevron below is positioned rather than laid out.
      className="relative flex min-h-14 w-full flex-row items-center rounded-xl border border-control bg-surface/50 px-4 py-2.5 shadow-xs">
      {/* In the subtree rather than in `aria-label`: a live region announces its content and not its
          name, so a name is all a reader would not hear. */}
      <span className="sr-only">Saisonauswahl wird geladen</span>
      {/* The trigger's own classes, so the two line boxes compute by the same rules at every breakpoint. */}
      <div className="flex flex-col gap-0.5">
        <span className={`${skeletonBlock()} block w-[6.024em] rounded-md fluid-lg`}>&nbsp;</span>
        <span className={`${skeletonBlock()} block w-[13.198em] rounded fluid-xxs`}>&nbsp;</span>
      </div>

      {/* Positioned, not laid out: HeroUI declares `.select__indicator` `absolute inset-y-0 end-2 my-auto`, so a
          flex item here would sit inside the trigger's padding and jump on swap. */}
      <span
        aria-hidden="true"
        className={`${skeletonBlock()} absolute inset-y-0 end-2 my-auto size-4 shrink-0 rounded`}
      />
    </div>
  );
}
