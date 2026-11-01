import { Suspense } from "react";

import { getGenannteFassung } from "@/core/einwilligung";
import { gekeyteFassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL } from "@/core/einwilligungSeiten";
import { BestaetigungView } from "@/features/bewerbungen/components/views/BestaetigungView";
import { getEinwilligungAnsicht } from "@/features/bewerbungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { BestaetigungStart } from "@/features/bewerbungen/components/views/BestaetigungView";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as `/signin` spells it;
 * `referrer` keeps the link's token off the referer a press on „Datenschutzerklärung“ would send.
 */
export const metadata: Metadata = {
  title: "Eintrag bestätigen",
  description: "Bestätige Deinen Eintrag als Kontaktperson in der Bewerbung Deiner Schule bei der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/bestaetigung/kontakt"),
  alternates: { canonical: "/bestaetigung/kontakt" },
};

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL.
 */
export default function BestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <BestaetigungContent {...props} />
    </Suspense>
  );
}

async function BestaetigungContent(props: NextPageProps) {
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  if (typeof token !== "string" || token === "") return <BestaetigungView start={{ zustand: "invalid" }} />;

  // A failed read is its own state, the dead-link panel calling a live link void. A broken contract is
  // no failed read: it reaches the error boundary, which logs it.

  const start: BestaetigungStart = await runWithIncomingTrace(() =>
    getEinwilligungAnsicht(token).then(
      async (gelesen): Promise<BestaetigungStart> => {
        // Offered the Widerspruch alone, which shows no stamped words.
        if (gelesen.zustand === "saison_past") return { zustand: "saison_past", ansicht: gelesen.ansicht, token: token };
        if (gelesen.zustand !== "valid") return gelesen;

        // After the link's read, never beside it: the view names the label by how the seat was filled.
        // A failed read is the panel below; a label the registry does not hold reaches the error boundary.
        const fassung = await getGenannteFassung(gelesen.ansicht.running_wording).catch(nullUnlessContractBreak);

        // A page with no words to show is a page that cannot be answered, which the failed read's panel says.
        if (fassung === null) return { zustand: "unlesbar" };

        // Uncaught: words this page cannot key are a broken contract, which the error boundary logs.
        const worte = gekeyteFassung(fassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL);
        return { zustand: "valid", ansicht: gelesen.ansicht, token: token, wording: worte };
      },
      (error: unknown): BestaetigungStart => nullUnlessContractBreak(error) ?? { zustand: "unlesbar" },
    ),
  );

  return <BestaetigungView start={start} />;
}
