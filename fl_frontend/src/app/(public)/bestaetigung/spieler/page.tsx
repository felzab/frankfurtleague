import { Suspense } from "react";
import { connection } from "next/server";

import { getLaufendeFassung } from "@/core/einwilligung";
import { gekeyteFassung, SPIELER_ABSATZ_SCHLUESSEL, SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL } from "@/core/einwilligungSeiten";
import { nullUnlessContractBreak } from "@/core/errors";
import { SpielerBestaetigungView } from "@/features/registrierungen/components/views/SpielerBestaetigungView";
import { EINWILLIGUNG_UMFANG_OPTIONS } from "@/features/registrierungen/constants";
import { getSpielerBestaetigungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { FLEinwilligungFassung } from "@/core/schemas";
import type { FLRegistrierungSeite } from "@/features/registrierungen/schemas";
import type { SpielerBestaetigungStart, SpielerSeitenFassung } from "@/features/registrierungen/types";
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

  // Beside the link's read, which names the page, and per request: a deploy moves the stamped label.
  // Settled together, so a contract break in either words' read reaches the error boundary rather than
  // rejecting unobserved.
  const [start, neu, wiederkehrend] = await Promise.all([
    typeof token === "string" && token !== ""
      ? getSpielerBestaetigungAnsicht(token).then(
          (gelesen): SpielerBestaetigungStart =>
            gelesen.zustand === "gueltig" ? { zustand: "gueltig", ansicht: gelesen.ansicht, token: token } : gelesen,
          (): SpielerBestaetigungStart => ({ zustand: "unlesbar" }),
        )
      : ({ zustand: "ungueltig" } satisfies SpielerBestaetigungStart),
    runWithIncomingTrace(() => getLaufendeFassung("bestaetigung_spieler")).catch(nullUnlessContractBreak),
    runWithIncomingTrace(() => getLaufendeFassung("bestaetigung_spieler_wiederkehrend")).catch(nullUnlessContractBreak),
  ]);

  return (
    <SpielerBestaetigungView
      start={start}
      fassung={start.zustand === "gueltig" ? seitenFassung(start.ansicht.seite, neu, wiederkehrend) : null}
    />
  );
}

/**
 * The words of the page the link opens, keyed as that page places them.
 *
 * Keyed outside the read's catch: words this page cannot key are a broken contract, which the error
 * boundary logs.
 */
function seitenFassung(
  seite: FLRegistrierungSeite,
  neu: FLEinwilligungFassung | null,
  wiederkehrend: FLEinwilligungFassung | null,
): SpielerSeitenFassung | null {
  if (seite === "bestaetigung_spieler") {
    return neu === null ? null : { ...gekeyteFassung(neu, SPIELER_ABSATZ_SCHLUESSEL, EINWILLIGUNG_UMFANG_OPTIONS), seite: seite };
  }

  return wiederkehrend === null
    ? null
    : { ...gekeyteFassung(wiederkehrend, SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL, EINWILLIGUNG_UMFANG_OPTIONS), seite: seite };
}
