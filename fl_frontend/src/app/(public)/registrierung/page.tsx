import { Suspense } from "react";

import { frontend_config } from "@/core/config";
import { mailedLinkToken } from "@/core/mailedLink";
import { ROUTES } from "@/core/routes";
import { RegistrierungView } from "@/features/registrierungen/components/views/RegistrierungView";
import { getEinladungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { RegistrierungStart } from "@/features/registrierungen/types";
import type { Metadata, ResolvingMetadata } from "next";

/** The mailed pages' referrer, and a row that keeps crawlers out. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.registrierung;
  return { ...(await pageMetadata(parent, row, row.path())), referrer: "no-referrer" };
}

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one visitor, and this page's
 * whole body is a function of the invite's token, which the proxy holds in this page's cookie.
 */
export default function RegistrierungPage() {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <RegistrierungContent />
    </Suspense>
  );
}

async function RegistrierungContent() {
  const token = await mailedLinkToken();

  // No token is no link at all and reads as the dead link.
  const start: RegistrierungStart =
    token !== null
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
