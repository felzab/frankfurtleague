import { Suspense } from "react";
import { connection } from "next/server";

import { getLaufendeFassung } from "@/core/einwilligung";
import { gekeyteFassung, SPIELER_ABSATZ_SCHLUESSEL } from "@/core/einwilligungSeiten";
import { SpielerBestaetigungView } from "@/features/registrierungen/components/views/SpielerBestaetigungView";
import { EINWILLIGUNG_UMFANG_OPTIONS } from "@/features/registrierungen/constants";
import { getSpielerBestaetigungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SpielerBestaetigungStart } from "@/features/registrierungen/types";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * A page file of its own under the segment rather than a `[type]` route: each confirmation page
 * keeps its own copy, `robots.ts` row and sitemap case.
 *
 * `referrer` keeps the token off the referer a press on the notice would send.
 */
export const metadata: Metadata = {
  title: "Registrierung bestätigen",
  description: "Bestätige Deine Registrierung für eine Saison der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/bestaetigung/spieler"),
  alternates: { canonical: "/bestaetigung/spieler" },
};

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL (`docs/frontend/spec.md :: I22`).
 */
export default function SpielerBestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <SpielerBestaetigungContent {...props} />
    </Suspense>
  );
}

async function SpielerBestaetigungContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // Beside the link's read, settled to `null` so a dead link's panel never waits on words it does not
  // show. Per request: a deploy moves the label the answer must stamp.
  const fassung = runWithIncomingTrace(() => getLaufendeFassung("bestaetigung_spieler"))
    .then((gelesen) => gekeyteFassung(gelesen, SPIELER_ABSATZ_SCHLUESSEL, EINWILLIGUNG_UMFANG_OPTIONS))
    .catch(() => null);

  const start: SpielerBestaetigungStart =
    typeof token === "string" && token !== ""
      ? await getSpielerBestaetigungAnsicht(token).then(
          (gelesen) => (gelesen.zustand === "gueltig" ? { zustand: "gueltig", ansicht: gelesen.ansicht, token: token } : gelesen),
          () => ({ zustand: "unlesbar" }),
        )
      : { zustand: "ungueltig" };

  return (
    <SpielerBestaetigungView
      start={start}
      fassung={await fassung}
    />
  );
}
