import { Suspense } from "react";
import { connection } from "next/server";

import { startOf } from "@/features/schiedsrichter/adresswechselStart";
import { SchiedsrichterAdresswechselView } from "@/features/schiedsrichter/components/views/SchiedsrichterAdresswechselView";
import { getSchiedsrichterAdresswechselAnsicht } from "@/features/schiedsrichter/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { SchiedsrichterAdresswechselStart } from "@/features/schiedsrichter/adresswechselStart";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/** `noindex` and `no-referrer` for the consent link page's reasons. */
export const metadata: Metadata = {
  title: "Neue E-Mail-Adresse bestätigen",
  description: "Bestätige die neue E-Mail-Adresse Deines Eintrags als Schiedsrichterin oder Schiedsrichter bei der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/bestaetigung/schiedsrichter/adresse"),
  alternates: { canonical: "/bestaetigung/schiedsrichter/adresse" },
};

/** Resolves nothing itself, for the consent link page's reason (`docs/frontend/spec.md :: I22`). */
export default function SchiedsrichterAdresswechselPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <SchiedsrichterAdresswechselContent {...props} />
    </Suspense>
  );
}

async function SchiedsrichterAdresswechselContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  if (typeof token !== "string" || token === "") return <SchiedsrichterAdresswechselView start={{ zustand: "ungueltig" }} />;

  // Caught, so a failed read is its own state: the dead-link panel would call a live link void.
  const start: SchiedsrichterAdresswechselStart = await getSchiedsrichterAdresswechselAnsicht(token).then(
    (gelesen) => startOf(gelesen, token),
    () => ({ zustand: "unlesbar" }),
  );

  return <SchiedsrichterAdresswechselView start={start} />;
}
