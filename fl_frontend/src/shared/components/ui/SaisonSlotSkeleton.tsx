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
      className="border-control bg-surface/50 relative flex min-h-14 w-full flex-row items-center rounded-xl border px-4 py-2.5 shadow-xs">
      {/* In the subtree rather than in `aria-label`: a live region announces what its content changes
          to, and a name is not content, so the region announced nothing at all. */}
      <span className="sr-only">Saisonauswahl wird geladen</span>
      {/* The trigger's own classes, so the two line boxes compute by the same rules at every breakpoint. */}
      <div className="flex flex-col gap-0.5">
        <span className={`${skeletonBlock()} fluid-lg block w-[6.024em] rounded-md`}>&nbsp;</span>
        <span className={`${skeletonBlock()} fluid-xxs block w-[13.198em] rounded`}>&nbsp;</span>
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
