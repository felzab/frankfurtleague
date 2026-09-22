import { Suspense } from "react";
import { connection } from "next/server";

import { SPIELER_EINWILLIGUNG } from "@/core/einwilligung";
import { SpielerBestaetigungView } from "@/features/registrierungen/components/views/SpielerBestaetigungView";
import { getSpielerBestaetigungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

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

  const start: SpielerBestaetigungStart =
    typeof token === "string" && token !== ""
      ? await getSpielerBestaetigungAnsicht(token).then(
          (gelesen) => (gelesen.zustand === "gueltig" ? { zustand: "gueltig", ansicht: gelesen.ansicht, token: token } : gelesen),
          () => ({ zustand: "unlesbar" }),
        )
      : { zustand: "ungueltig" };

  // Every word off the CURRENT LABEL's own entry, the paragraphs included: a page reaching past the
  // label for its wording renders whatever that object holds after the next rewording, under a
  // label whose records cite the words before it.
  return (
    <SpielerBestaetigungView
      start={start}
      fassung={{
        textVersion: SPIELER_EINWILLIGUNG.textVersion,
        absaetze: SPIELER_EINWILLIGUNG.absaetzeNachSchluessel,
        schalter: SPIELER_EINWILLIGUNG.schalter,
        bedienelemente: SPIELER_EINWILLIGUNG.bedienelemente,
      }}
    />
  );
}
