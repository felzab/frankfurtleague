import { Suspense } from "react";

import { ROUTES } from "@/core/routes";
import { SpielerBestaetigungView } from "@/features/registrierungen/components/views/SpielerBestaetigungView";
import { getSpielerBestaetigungAnsicht } from "@/features/registrierungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SpielerBestaetigungStart } from "@/features/registrierungen/types";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvingMetadata } from "next";

/**
 * A page file of its own under the segment rather than a `[type]` route: each confirmation page
 * keeps its own copy and its own row in `fl_frontend/src/core/routes.ts :: ROUTES`.
 *
 * `referrer` keeps the token off the referer a press on the notice would send.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.registrierungConfirmation;
  return { ...(await pageMetadata(parent, row, row.path())), referrer: "no-referrer" };
}

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL.
 */
export default function SpielerBestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <SpielerBestaetigungContent {...props} />
    </Suspense>
  );
}

async function SpielerBestaetigungContent(props: NextPageProps) {
  const { token } = await props.searchParams;

  // A contract break reaches the error boundary rather than rejecting unobserved.
  const start: SpielerBestaetigungStart =
    typeof token === "string" && token !== ""
      ? await runWithIncomingTrace(() =>
          getSpielerBestaetigungAnsicht(token).then(
            (gelesen): SpielerBestaetigungStart =>
              gelesen.zustand === "valid" ? { zustand: "valid", ansicht: gelesen.ansicht, token: token } : gelesen,
            // A failed read is its own state, the dead-link panel calling a live link void.
            (error: unknown): SpielerBestaetigungStart => nullUnlessContractBreak(error) ?? { zustand: "unlesbar" },
          ),
        )
      : { zustand: "invalid" };

  return (
    <SpielerBestaetigungView
      start={start}
      wording={start.zustand === "valid" ? { seite: start.ansicht.seite } : null}
    />
  );
}
