import { band } from "@/features/bewerbungen/components/ui/BewerbungOffenBand";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { skeletonBlock } from "@/shared/components/ui/skeleton";

/**
 * The band's own box while the window read is still out.
 *
 * **Built from `band()` and `ctaButton()`, never from copies of their classes**: the height is what
 * this has to get right, and a second spelling is one nobody re-measures.
 */
export function BewerbungBandSkeleton({ ground = "surface" }: { ground?: "surface" | "field" }) {
  const styles = band({ ground: ground });
  const tone = ground === "field" ? "field" : "surface";

  return (
    <div
      role="status"
      aria-label="Wird geladen"
      className={styles.root()}>
      <div className="flex w-full flex-row items-center gap-3 lg:w-auto">
        <span className={`${skeletonBlock({ tone: tone })} size-2 shrink-0 rounded-full`} />
        {/* The sentence's own line box, carried invisibly so the bar sits in it rather than beside
            it: the real band wraps to two lines on a phone and this has to wrap with it. */}
        <span className={`${styles.text()} relative block w-full min-w-0`}>
          <span className="invisible">&nbsp;</span>
          <span className={`${skeletonBlock({ tone: tone })} absolute inset-y-0 left-0 w-full max-w-[34ch] rounded-md`} />
        </span>
      </div>

      {/* The control's own recipe held invisibly, so the block inherits its height at every
          breakpoint instead of restating it as a number. */}
      <span className="relative block w-full shrink-0 lg:w-56">
        <span className={`${ctaButton({ intent: "primary", size: "sm", hover: "css" })} invisible w-full`}>&nbsp;</span>
        <span className={`${skeletonBlock({ tone: tone })} absolute inset-0 rounded-xl`} />
      </span>
    </div>
  );
}
