import { Suspense } from "react";

import { frontend_config } from "@/core/config";
import { ROUTES } from "@/core/routes";
import { runWithIncomingTrace } from "@/core/traceScope";
import { RegistrierungView } from "@/features/registrierungen/components/views/RegistrierungView";
import { getEinladungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { pageMetadata } from "@/shared/utils/metadata";

import type { RegistrierungStart } from "@/features/registrierungen/types";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvingMetadata } from "next";

/**
 * `referrer` keeps the invite's token off the referer a press on „Datenschutzerklärung“ would send; the row keeps
 * crawlers out.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.registrierung;
  return { ...(await pageMetadata(parent, row, row.path())), referrer: "no-referrer" };
}

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL.
 */
export default function RegistrierungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <RegistrierungContent {...props} />
    </Suspense>
  );
}

async function RegistrierungContent(props: NextPageProps) {
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  const start: RegistrierungStart =
    typeof token === "string" && token !== ""
      ? await runWithIncomingTrace(() =>
          getEinladungAnsicht(token).then(
            (gelesen) => gelesen,
            // A failed read is its own state, the dead-link panel calling a live invite void. A broken contract
            // is no failed read: it reaches the error boundary, which logs it.
            (error: unknown): RegistrierungStart => nullUnlessContractBreak(error) ?? { zustand: "unlesbar" },
          ),
        )
      : { zustand: "invalid" };

  return (
    <RegistrierungView
      start={start}
      // Off the request's settings, past the search parameters: a prerendered shell would carry the build's, which is none.
      siteKey={frontend_config.TURNSTILE_SITE_KEY}
    />
  );
}
