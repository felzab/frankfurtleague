import { Suspense } from "react";
import { connection } from "next/server";

import { startOf } from "@/features/spieler/adresswechselStart";
import { SpielerAdresswechselView } from "@/features/spieler/components/views/SpielerAdresswechselView";
import { getSpielerAdresswechselAnsicht } from "@/features/spieler/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { openGraphFor } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SpielerAdresswechselStart } from "@/features/spieler/adresswechselStart";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/** `noindex` and `no-referrer`: the URL carries the link's token, which no crawler and no outbound referer may keep. */
export const metadata: Metadata = {
  title: "Neue E-Mail-Adresse bestätigen",
  description: "Bestätige die neue E-Mail-Adresse Deines Eintrags als Spielerin oder Spieler bei der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/bestaetigung/spieler/adresse"),
  alternates: { canonical: "/bestaetigung/spieler/adresse" },
};

/** Resolves nothing itself, for the consent link page's reason (`docs/frontend/spec.md :: I22`). */
export default function SpielerAdresswechselPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <SpielerAdresswechselContent {...props} />
    </Suspense>
  );
}

async function SpielerAdresswechselContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  if (typeof token !== "string" || token === "") return <SpielerAdresswechselView start={{ zustand: "ungueltig" }} />;

  // A failed read is its own state, the dead-link panel calling a live link void. A broken contract is
  // no failed read: it reaches the error boundary, which logs it.
  const start: SpielerAdresswechselStart = await runWithIncomingTrace(() =>
    getSpielerAdresswechselAnsicht(token).then(
      (gelesen) => startOf(gelesen, token),
      (error: unknown): SpielerAdresswechselStart => nullUnlessContractBreak(error) ?? { zustand: "unlesbar" },
    ),
  );

  return <SpielerAdresswechselView start={start} />;
}
