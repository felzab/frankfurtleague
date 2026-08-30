import Link from "next/link";

import { Callout } from "@/shared/components/ui/Callout";
import { textLink } from "@/shared/components/ui/textLink";

import type { Leserichtung } from "@/features/bewerbungen/utils";

/**
 * What a cut-short answer offers: which end of the queue is loaded, and the link to the other one.
 * Reversing is the only recovery, because a flood lands in the season and status the page opens on.
 */
export type BewerbungenUnvollstaendig = { richtung: Leserichtung; umkehrHref: string };

/**
 * The standing notice a partial queue carries. Its own component so a test can render it without the
 * view's router-bound chrome, this being the one composition whose markup has to be read rather than
 * reasoned about.
 */
export function BewerbungenUnvollstaendigNotice({ richtung, umkehrHref }: BewerbungenUnvollstaendig) {
  const geladen = richtung === "desc" ? "die neuesten" : "die ältesten";
  const andere = richtung === "desc" ? "die ältesten" : "die neuesten";

  return (
    // Not `isAnnounced`, and not dismissible: this is a standing property of the answer, and a closed
    // notice would leave a partial queue looking whole.
    <Callout
      severity="warning"
      title="Diese Liste ist unvollständig">
      Dubletten werden nur unter den geladenen Zeilen erkannt. Ein Paar, das die Grenze trennt, bleibt unmarkiert, und es ist nicht erkennbar,
      welches. Auch die Zahlen an den Filtern zählen nur die geladenen Zeilen. Geladen sind {geladen} Bewerbungen.{" "}
      <Link
        href={umkehrHref}
        className={textLink()}>
        Lade {andere} zuerst
      </Link>
      . Auch diese Ansicht bleibt unvollständig.
    </Callout>
  );
}
