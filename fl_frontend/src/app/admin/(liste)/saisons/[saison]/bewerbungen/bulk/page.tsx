import { notFound } from "next/navigation";

import { StepsPage } from "@/kit/StepsPage";

import { ROUTES } from "@/core/routes";
import { ACCEPT_RULES } from "@/features/bewerbungen/fieldRules";
import { getBewerbungenOfSaison } from "@/features/bewerbungen/queries";
import { standingOf } from "@/features/bewerbungen/standing";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { SammelZusage } from "./SammelZusage";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/bewerbungen/bulk">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getBewerbungenOfSaison(saison), () =>
    pageMetadata(parent, ROUTES.adminBewerbungenBulk, ROUTES.adminBewerbungenBulk.path(saison)),
  );
}

/** The season's complete, undecided applications, oldest first, as they came in, with the groups an acceptance may name. */
async function readRun(params: Props["params"]) {
  const { saison } = await params;
  const read = await getBewerbungenOfSaison(saison);
  if (read === null) notFound();
  return (
    <SammelZusage
      saison={saison}
      rows={read.bewerbungen.filter((row) => standingOf(row) === "complete").toReversed()}
      gruppen={read.saison.gruppen}
      rules={ACCEPT_RULES}
    />
  );
}

/** The Sammel-Zusage: every complete, undecided application of the season, taken one card at a time and confirmed once. */
export default function SammelZusagePage({ params }: Props) {
  return (
    <StepsPage
      title={{ route: "adminBewerbungenBulk" }}
      steps={readRun(params)}
    />
  );
}
