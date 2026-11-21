import { notFound } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getKoRunde } from "@/features/saisons/queries";
import { publicSaisonOf, resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { BracketTree } from "@/kit/BracketTree";
import { EmptyBox } from "@/kit/EmptyState";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { treeOf } from "./tree";

import type { Metadata } from "next";

type Props = PageProps<"/saisons/[saison]/ko-runde">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(publicSaisonOf(params), (saison) =>
    pageMetadata(ROUTES.kORunde, ROUTES.kORunde.path(saison), { description: SERVER_COPY.description.kORunde(saison) }),
  );
}

/** The K.-o.-Runde: the K.-o.-Baum on the page, the match for third place on its row above the Finale. */
export default function KoRundePage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "kORunde" } }}
      list={{ kind: "drawn", content: readTree(params) }}
    />
  );
}

/** The K.-o.-Baum, or the empty state before the draw. */
async function readTree(params: Props["params"]) {
  const read = await getKoRunde(await resolvePublicSaisonParam(params));
  if (read === null) notFound();
  const tree = treeOf(read.spieltage);
  return tree === null ? (
    <EmptyBox
      kind="none"
      plural={COPY.shared.kORunde}
      glyph="kORunde"
    />
  ) : (
    <BracketTree {...tree} />
  );
}
