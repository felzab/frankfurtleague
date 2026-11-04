import { Suspense } from "react";

import { ROUTES } from "@/core/routes";
import { AdresswechselLinkView } from "@/features/adresswechsel/components/views/AdresswechselLinkView";
import { startOf } from "@/features/adresswechsel/link";
import { getAdresswechselAnsicht } from "@/features/adresswechsel/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { AdresswechselStart } from "@/features/adresswechsel/link";
import type { NextPageProps } from "@/shared/types/types";
import type { Metadata, ResolvingMetadata } from "next";

/**
 * `no-referrer`, and a row no crawler fetches: the URL carries the link's token, which no crawler and no outbound
 * referer may keep. The title fits both links, the new mailbox's and the stop link of the address on file.
 */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.addressChangeConfirmation;
  return { ...(await pageMetadata(parent, row, row.path())), referrer: "no-referrer" };
}

/** Resolves nothing itself, for the consent link page's reason. */
export default function AdresswechselPage(props: NextPageProps) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <AdresswechselContent {...props} />
    </Suspense>
  );
}

async function AdresswechselContent(props: NextPageProps) {
  const { token } = await props.searchParams;

  // A missing or repeated parameter is no link at all and reads as the dead link.
  if (typeof token !== "string" || token === "") return <AdresswechselLinkView start={{ zustand: "invalid" }} />;

  // A failed read is its own state, the dead-link panel calling a live link void. A broken contract is
  // no failed read: it reaches the error boundary, which logs it.
  const start: AdresswechselStart = await runWithIncomingTrace(() =>
    getAdresswechselAnsicht(token).then(
      (gelesen) => startOf(gelesen, token),
      (error: unknown): AdresswechselStart => nullUnlessContractBreak(error) ?? { zustand: "unlesbar" },
    ),
  );

  return <AdresswechselLinkView start={start} />;
}
