import { notFound } from "next/navigation";

import { CalloutPlaceholder } from "@/kit/Callout";
import { FieldGroupPlaceholder } from "@/kit/FieldGroup";
import { FieldPlaceholder } from "@/kit/FieldPair";
import { StepCardPlaceholder } from "@/kit/StepCard";
import { StepsPage } from "@/kit/StepsPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SHORTHAND_LENGTH } from "@/features/bewerbungen/constants";
import { ACCEPT_RULES } from "@/features/bewerbungen/fieldRules";
import { getBewerbungenOfSaison } from "@/features/bewerbungen/queries";
import { standingOf } from "@/features/bewerbungen/standing";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { BulkAccept } from "./BulkAccept";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/bewerbungen/bulk">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getBewerbungenOfSaison(saison), () =>
    pageMetadata(parent, ROUTES.adminBewerbungenBulk, ROUTES.adminBewerbungenBulk.path(saison)),
  );
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
      rules={ACCEPT_RULES}
    />
  );
}

/** The Sammel-Zusage: every complete, undecided application of the season, taken one card at a time and confirmed once. */
export default function BulkAcceptPage({ params }: Props) {
  return (
    <StepsPage
      title={{ route: "adminBewerbungenBulk" }}
      wait={
        // A new school's card, the taller of the two: its code stands in a group of its own, with the word on its address.
        <StepCardPlaceholder facts={5}>
          <FieldPlaceholder />
          <FieldPlaceholder />
          <FieldGroupPlaceholder>
            <FieldPlaceholder
              holds={5}
              description={COPY.team.shorthandDescription(SHORTHAND_LENGTH)}
            />
            <CalloutPlaceholder text={COPY.admin.bewerbung.addressPublic} />
          </FieldGroupPlaceholder>
        </StepCardPlaceholder>
      }
      steps={readRun(params)}
    />
  );
}
