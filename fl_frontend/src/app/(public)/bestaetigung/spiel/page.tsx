import { Suspense } from "react";
import { connection } from "next/server";

import { SpielbestaetigungView } from "@/features/spielbestaetigungen/components/views/SpielbestaetigungView";
import { getSpielbestaetigungAnsicht } from "@/features/spielbestaetigungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as the contact confirmation spells it;
 * `referrer` keeps the link's token off the referer any link on the page would send.
 */
export const metadata: Metadata = {
  title: "Spieltermin bestätigen",
  description: "Bestätige den Termin eines Spiels Deines Teams in der Frankfurt League, oder schlag einen anderen vor.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/bestaetigung/spiel"),
  alternates: { canonical: "/bestaetigung/spiel" },
};

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL.
 */
export default function SpielbestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <SpielbestaetigungContent {...props} />
    </Suspense>
  );
}

async function SpielbestaetigungContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  if (typeof token !== "string" || token === "") return <SpielbestaetigungView start={{ zustand: "ungueltig" }} />;

  // A failed read is its own state: the dead-link panel there would call a live link void. A broken
  // contract is no failed read and reaches the error boundary, which logs it.
  const gelesen = await runWithIncomingTrace(() => getSpielbestaetigungAnsicht(token).catch(nullUnlessContractBreak));

  if (gelesen === null) return <SpielbestaetigungView start={{ zustand: "unlesbar" }} />;
  if (gelesen.zustand !== "gueltig" && gelesen.zustand !== "vorschlag") return <SpielbestaetigungView start={gelesen} />;

  return <SpielbestaetigungView start={{ zustand: gelesen.zustand, ansicht: gelesen.ansicht, token: token }} />;
}
