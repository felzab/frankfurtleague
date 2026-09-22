import { Suspense } from "react";
import { connection } from "next/server";

import { RegistrierungView } from "@/features/registrierungen/components/views/RegistrierungView";
import { getEinladungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { openGraphFor } from "@/shared/utils/metadata";

import type { RegistrierungStart } from "@/features/registrierungen/types";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

/**
 * `noindex` as `/signin` spells it, which `fl_frontend/src/app/sitemap.test.ts` matches by path;
 * `referrer` keeps the invite's token off the referer a press on „Datenschutzerklärung“ would send.
 */
export const metadata: Metadata = {
  title: "Registrierung",
  description: "Registriere Dich mit dem Link Deines Teams für eine Saison der Frankfurt League.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  openGraph: openGraphFor("/registrierung"),
  alternates: { canonical: "/registrierung" },
};

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL (`docs/frontend/spec.md :: I22`).
 */
export default function RegistrierungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <RegistrierungContent {...props} />
    </Suspense>
  );
}

async function RegistrierungContent(props: NextPageProps) {
  await connection();
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link. Caught, so a
  // failed read is its own state: the dead-link panel there would call a live invite void.
  const start: RegistrierungStart =
    typeof token === "string" && token !== ""
      ? await getEinladungAnsicht(token).then(
          (gelesen) => gelesen,
          () => ({ zustand: "unlesbar" }),
        )
      : { zustand: "ungueltig" };

  return <RegistrierungView start={start} />;
}
