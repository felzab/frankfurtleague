import { Suspense } from "react";
import { connection } from "next/server";

import { getLaufendeFassung } from "@/core/einwilligung";
import { gekeyteFassung, SCHIEDSRICHTER_ABSATZ_SCHLUESSEL } from "@/core/einwilligungSeiten";
import { nullUnlessContractBreak } from "@/core/errors";
import { SchiedsrichterBestaetigungView } from "@/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView";
import { SCHIEDSRICHTER_UMFANG_WERTE } from "@/features/schiedsrichter/constants";
import { getSchiedsrichterBestaetigungAnsicht } from "@/features/schiedsrichter/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SchiedsrichterBestaetigungStart } from "@/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as the contact confirmation spells it, which `fl_frontend/src/app/sitemap.test.ts`
 * matches by path; `referrer` keeps the link's token off the referer a press on
 * „Datenschutzerklärung“ would send.
 */
export const metadata: Metadata = {
  title: "Eintrag bestätigen",
  description: "Bestätige Deinen Eintrag als Schiedsrichterin oder Schiedsrichter bei der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/bestaetigung/schiedsrichter"),
  alternates: { canonical: "/bestaetigung/schiedsrichter" },
};

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL (`docs/frontend/spec.md :: I22`).
 */
export default function SchiedsrichterBestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <SchiedsrichterBestaetigungContent {...props} />
    </Suspense>
  );
}

async function SchiedsrichterBestaetigungContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link. Caught, so a
  // failed read is its own state: the dead-link panel there would call a live link void.
  if (typeof token !== "string" || token === "") return <SchiedsrichterBestaetigungView start={{ zustand: "ungueltig" }} />;

  // Beside the link's read, and per request: a deploy moves the label the answer must stamp. Settled
  // together, so a contract break in the words' read reaches the error boundary whatever the link's
  // state rather than rejecting unobserved.
  const [gelesen, geleseneWorte] = await Promise.all([
    getSchiedsrichterBestaetigungAnsicht(token).catch((): null => null),
    runWithIncomingTrace(() => getLaufendeFassung("bestaetigung_schiedsrichter")).catch(nullUnlessContractBreak),
  ]);

  if (gelesen === null) return <SchiedsrichterBestaetigungView start={{ zustand: "unlesbar" }} />;
  if (gelesen.zustand !== "gueltig") return <SchiedsrichterBestaetigungView start={gelesen} />;

  // A page with no words to show cannot be answered, which the failed read's panel says.
  if (geleseneWorte === null) return <SchiedsrichterBestaetigungView start={{ zustand: "unlesbar" }} />;

  // Uncaught: words this page cannot key are a broken contract, which the error boundary logs.
  const worte = gekeyteFassung(geleseneWorte, SCHIEDSRICHTER_ABSATZ_SCHLUESSEL, SCHIEDSRICHTER_UMFANG_WERTE);
  const start: SchiedsrichterBestaetigungStart = { zustand: "gueltig", ansicht: gelesen.ansicht, token: token, fassung: worte };

  return <SchiedsrichterBestaetigungView start={start} />;
}
