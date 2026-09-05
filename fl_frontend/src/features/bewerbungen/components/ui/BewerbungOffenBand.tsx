import Link from "next/link";
import { connection } from "next/server";

import { band } from "@/features/bewerbungen/components/ui/band";
import { getOffenesBewerbungFenster } from "@/features/bewerbungen/queries";
import { ctaButton } from "@/shared/components/ui/formButtons";

import type { ReactNode } from "react";

/**
 * The way into the application form, rendered ONLY while a season's window is running.
 *
 * A read per render rather than a cached one: `laeuft` is a judgement against today. Wrap it in its
 * own `<Suspense>` so the page around it does not wait on this.
 */
export async function BewerbungOffenBand({
  ersatz = null,
}: {
  /**
   * What the slot holds the rest of the year. Returned from HERE rather than rendered beside the
   * call, which is what makes "at most one band" structural instead of a rule two call sites keep.
   */
  ersatz?: ReactNode;
}) {
  // The image builder reaches no backend, so this read has to be kept out of the build.
  await connection();

  const fenster = await getOffenesBewerbungFenster();
  if (fenster === null) return ersatz;

  const styles = band();

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
        // The brand fill: this is the one thing the band exists to be pressed.
        className={`${ctaButton({ intent: "primary", size: "sm", hover: "css" })} w-full shrink-0 lg:w-56`}>
        Jetzt bewerben
      </Link>
    </div>
  );
}
