import Link from "next/link";
import { connection } from "next/server";

import { tv } from "tailwind-variants";

import { getOffenesBewerbungFenster } from "@/features/bewerbungen/queries";
import { ctaButton } from "@/shared/components/ui/formButtons";

import type { ReactNode } from "react";

/**
 * The shell every band in the slot wears. TWO grounds, because the two pages have two: the landing card, and
 * the `(meta)` pitch whose own cards this one sits among rather than cutting a pale rectangle into. The ground
 * decides the season's colour.
 */
export const band = tv({
  slots: {
    root: "relative flex w-full flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:py-5",
    text: "fluid-sm font-bold",
    dot: "bg-brand-solid min-h-2 min-w-2 animate-pulse rounded-full",
    /* Weight here, colour per ground: brand on the pitch card measures 1.32:1 light and 3.05:1 dark, and no
       red light enough to clear 4.5:1 on that green is still the brand. */
    saison: "font-extrabold",
  },
  variants: {
    ground: {
      surface: { root: "border-border bg-surface shadow-xs", text: "text-foreground", saison: "text-brand" },
      // The page's own card recipe, so the band reads as one of the blocks around it. No `saison` colour: the
      // phrase takes the band's own `text-field-fg`, which is the one thing that reads on this green.
      field: { root: "soccer-field-card-bg soccer-field-card-border shadow-xl", text: "text-field-fg" },
    },
  },
  defaultVariants: { ground: "surface" },
});

/**
 * The way into the application form, rendered ONLY while a season's window is running.
 *
 * A read per render rather than a cached one: `laeuft` is a judgement against today. Wrap it in its
 * own `<Suspense>` so the page around it does not wait on this.
 */
export async function BewerbungOffenBand({
  ersatz = null,
  ground = "surface",
}: {
  /**
   * What the slot holds the rest of the year. Returned from HERE rather than rendered beside the
   * call, which is what makes "at most one band" structural instead of a rule two call sites keep.
   */
  ersatz?: ReactNode;
  /** Which page's ground this band sits on; the two are not interchangeable. */
  ground?: "surface" | "field";
}) {
  // The image builder reaches no backend, so this read has to be kept out of the build.
  await connection();

  const fenster = await getOffenesBewerbungFenster();
  if (fenster === null) return ersatz;

  const styles = band({ ground: ground });

  return (
    <div className={styles.root()}>
      <div className="flex flex-row items-center gap-3">
        <span className={styles.dot()} />
        <span className={styles.text()}>
          Deine Schule will mitmachen? Die Bewerbungen für die <span className={styles.saison()}>Saison {fenster.saison_id}</span> sind gerade
          offen!
        </span>
      </div>

      <Link
        href={`/bewerbung/${fenster.saison_id}`}
        prefetch={false}
        // The brand fill on both grounds: this is the one thing the band exists to be pressed, and an
        // outline on the pitch card would rank it below the channel cards under it.
        className={`${ctaButton({ intent: "primary", size: "sm", hover: "css" })} w-full shrink-0 lg:w-56`}>
        Jetzt bewerben
      </Link>
    </div>
  );
}
