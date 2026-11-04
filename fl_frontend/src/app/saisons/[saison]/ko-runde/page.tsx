import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getKoRunde } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { pageMetadata } from "@/shared/utils/metadata";

import { treeOf } from "./tree";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/ko-runde">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const saison = await resolvePublicSaisonParam(params);
  return pageMetadata(parent, ROUTES.kORunde, ROUTES.kORunde.path(saison), { description: SERVER_COPY.description.kORunde(saison) });
}

/** The K.-o.-Runde: the K.-o.-Baum on the page, the match for third place on its row above the Finale. */
export default function KoRundePage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "kORunde" } }}
      list={{ kind: "tree", content: readTree(params) }}
    />
  );
}

async function readTree(params: Props["params"]) {
  const read = await getKoRunde(await resolvePublicSaisonParam(params));
  if (read === null) notFound();
  return { tree: treeOf(read.spieltage), empty: { kind: "none" as const, plural: COPY.shared.kORunde } };
}
