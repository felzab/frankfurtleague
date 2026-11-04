import { Suspense } from "react";

import { ROUTES } from "@/core/routes";
import { BestaetigungView } from "@/features/bewerbungen/components/views/BestaetigungView";
import { getEinwilligungAnsicht } from "@/features/bewerbungen/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { BestaetigungStart } from "@/features/bewerbungen/components/views/BestaetigungView";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvingMetadata } from "next";

/**
 * `referrer` keeps the link's token off the referer a press on „Datenschutzerklärung“ would send; the row keeps
 * crawlers out.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.kontaktConfirmation;
  return { ...(await pageMetadata(parent, row, row.path())), referrer: "no-referrer" };
}

/**
 * Resolves nothing itself: a top-level await would tie the App Shell to one URL, and this page's
 * whole body is a function of the token in that URL.
 */
export default function BestaetigungPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <BestaetigungContent {...props} />
    </Suspense>
  );
}

async function BestaetigungContent(props: NextPageProps) {
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  if (typeof token !== "string" || token === "") return <BestaetigungView start={{ zustand: "invalid" }} />;

  // A failed read is its own state, the dead-link panel calling a live link void. A broken contract is
  // no failed read: it reaches the error boundary, which logs it.

  const start: BestaetigungStart = await runWithIncomingTrace(() =>
    getEinwilligungAnsicht(token).then(
      (gelesen): BestaetigungStart => {
        // Offered the Widerspruch alone.
        if (gelesen.zustand === "saison_past") return { zustand: "saison_past", ansicht: gelesen.ansicht, token: token };
        if (gelesen.zustand !== "valid") return gelesen;

        return { zustand: "valid", ansicht: gelesen.ansicht, token: token };
      },
      (error: unknown): BestaetigungStart => nullUnlessContractBreak(error) ?? { zustand: "unlesbar" },
    ),
  );

  return <BestaetigungView start={start} />;
}
