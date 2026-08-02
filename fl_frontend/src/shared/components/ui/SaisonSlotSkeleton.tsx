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
 * slab, and 70 was a guess: the real trigger has no fixed height at all. It is `min-h-14` plus a
 * `fluid-lg` name over a `fluid-xxs` timespan, so it measures ~65px at a phone width and ~71px at a
 * desktop one. Reusing the trigger's own shell classes and letting the same two text runs set the
 * height removes the guess.
 *
 * **The bar widths are the rendered text widths, in `em`, and that unit is the point.** Both runs
 * have a fixed character count — every season id is four characters, and the timespan is always two
 * `dd.mm.yyyy` dates around a hyphen — so each has one width per font size. Since the font size is
 * fluid, a `rem` width can only be right at one viewport — `w-28`/`w-36` run 15px and 16px short at
 * desktop. Every contribution to the width — glyph advances and the `tracking-*` letter-spacing
 * alike — scales linearly with font size, so the ratio is constant:
 * measured with canvas text metrics at the real computed font, 6.0238em and 13.1982em at 375px wide
 * and 6.0237em / 13.1981em at 1280px. Expressing them in `em` makes the bars exact at every width
 * rather than at one.
 *
 * It carries no text, so it needs the labelled status region or a screen-reader user gets silence
 * while it waits.
 */
export function SaisonSlotSkeleton() {
  return (
    <div
      role="status"
      aria-label="Saisonauswahl wird geladen"
      // `relative`, because the chevron below is positioned rather than laid out — see the note there.
      className="border-border/60 bg-surface/50 relative flex min-h-14 w-full flex-row items-center rounded-xl border px-4 py-2.5 shadow-xs">
      {/* `gap-0.5`, `fluid-lg` and `fluid-xxs` are the trigger's own, so the two line boxes are
          computed by the same rules as the real ones at every breakpoint. The timespan really does
          render at `fluid-xxs` — ADR-0025 is what keeps HeroUI's `Description` from dropping the
          size class — so this must not be pinned to a fixed size to compensate. */}
      <div className="flex flex-col gap-0.5">
        <span className={`${skeletonBlock()} fluid-lg block w-[6.024em] rounded-md`}>&nbsp;</span>
        <span className={`${skeletonBlock()} fluid-xxs block w-[13.198em] rounded`}>&nbsp;</span>
      </div>

      {/* The chevron's silhouette, positioned exactly where the real one sits.
          `Select.Indicator` is `.select__indicator`, which HeroUI declares `absolute inset-y-0 end-2
          my-auto` — it is OUT OF FLOW, 8px from the trigger's right edge. Laying this out as a flex
          item instead put it inside the `px-4` padding, i.e. 16px in, so the placeholder's chevron
          sat 8px left of the real one and visibly jumped on swap. Mirroring the positioning is the
          only way to land on the same pixel, because the offsets are HeroUI's, not this app's. */}
      <span
        aria-hidden="true"
        className={`${skeletonBlock()} absolute inset-y-0 end-2 my-auto size-4 shrink-0 rounded`}
      />
    </div>
  );
}
