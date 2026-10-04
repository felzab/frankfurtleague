import { Suspense } from "react";
import { connection } from "next/server";

import { getLaufendeFassung } from "@/core/einwilligung";
import { gekeyteFassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL } from "@/core/einwilligungSeiten";
import { BestaetigungView } from "@/features/bewerbungen/components/views/BestaetigungView";
import { getEinwilligungAnsicht } from "@/features/bewerbungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { BestaetigungStart } from "@/features/bewerbungen/components/views/BestaetigungView";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as `/signin` spells it, which `fl_frontend/src/app/sitemap.test.ts` matches by path;
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
 * whole body is a function of the token in that URL (`docs/frontend/spec.md :: I22`).
 */
export default function BestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <BestaetigungContent {...props} />
    </Suspense>
  );
}

async function BestaetigungContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link. Caught, so a
  // failed read is its own state: the dead-link panel there would call a live link void.
  if (typeof token !== "string" || token === "") return <BestaetigungView start={{ zustand: "ungueltig" }} />;

  // Beside the link's read rather than after it, and settled to `null` so a dead link's panel never
  // waits on words it does not show. Per request: a deploy moves the label the answer must stamp.
  const fassung = runWithIncomingTrace(() => getLaufendeFassung("bestaetigung_kontakt"))
    .then((gelesen) => gekeyteFassung(gelesen, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL))
    .catch(() => null);

  const start: BestaetigungStart = await getEinwilligungAnsicht(token).then(
    async (gelesen): Promise<BestaetigungStart> => {
      if (gelesen.zustand !== "gueltig") return gelesen;

      // A page with no words to show is a page that cannot be answered, which the failed read's panel says.
      const worte = await fassung;
      return worte === null ? { zustand: "unlesbar" } : { zustand: "gueltig", ansicht: gelesen.ansicht, token: token, fassung: worte };
    },
    () => ({ zustand: "unlesbar" }),
  );

  return <BestaetigungView start={start} />;
}
