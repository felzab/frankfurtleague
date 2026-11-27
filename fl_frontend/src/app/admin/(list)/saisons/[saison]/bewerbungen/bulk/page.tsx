import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { ROUTES } from "@/core/routes";
import { acceptBewerbung } from "@/features/bewerbungen/acceptBewerbung";
import { getBewerbungenOfSaison } from "@/features/bewerbungen/queries";
import { standingOf } from "@/features/bewerbungen/standing";
import { StepsPage } from "@/kit/StepsPage";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { BulkAccept } from "./BulkAccept";

import type { Metadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/bewerbungen/bulk">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getBewerbungenOfSaison(saison), () => pageMetadata(ROUTES.adminBewerbungenBulk, ROUTES.adminBewerbungenBulk.path(saison)));
}

/** The season's complete, undecided applications, oldest first, as they came in, with the groups and colours an acceptance may name. */
async function readRun(params: Props["params"]) {
  const { saison } = await params;
  const read = await getBewerbungenOfSaison(saison);
  if (read === null) notFound();
  return (
    <BulkAccept
      saison={saison}
      rows={read.bewerbungen.filter((row) => standingOf(row) === "complete").toReversed()}
      gruppen={read.saison.gruppen}
      taken={read.saison.taken}
      rules={boxRulesOf(acceptBewerbung)}
    />
  );
}

/** The Sammel-Zusage: every complete, undecided application of the season, taken one card at a time and confirmed once. */
export default function BulkAcceptPage({ params }: Props) {
  return (
    <StepsPage
      title={{ route: "adminBewerbungenBulk" }}
      steps={readRun(params)}
    />
  );
}
