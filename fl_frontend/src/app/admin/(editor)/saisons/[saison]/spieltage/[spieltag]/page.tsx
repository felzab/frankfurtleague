import { cache } from "react";
import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSpieltag } from "@/features/spieltage/queries";
import { spieltagLabel } from "@/features/spieltage/utils";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { saveSpieltag } from "./saveSpieltag";
import { SpieltagEditor } from "./SpieltagEditor";
import { valuesOf } from "./spieltagValues";

import type { FLSpieltagAdmin, FLSpieltagAdminResponse } from "@/core/generated/client/types";
import type { Metadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spieltage/[spieltag]">;

const read = cache(getAdminSpieltag);

/**
 * The matchday the address names, as every season page reads its record: `null` for a malformed id, for none by it,
 * and for one of another season.
 */
async function findSpieltag(params: Props["params"]): Promise<FLSpieltagAdminResponse | null> {
  const spieltag = await adminIdParamOf(params, "spieltag");
  const { saison } = await params;
  const view = spieltag === null ? null : await read(spieltag);
  return view === null || view.spieltag.saison_id !== saison ? null : view;
}

/** A matchday is named as its tab in the Spiele list names it. */
const nameOf = (spieltag: FLSpieltagAdmin) =>
  spieltagLabel({ phase: spieltag.saison_phase, ordinal: spieltag.position, countInPhase: spieltag.count_spieltage_in_phase });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findSpieltag(params), ({ spieltag }) =>
    pageMetadata(ROUTES.adminSpieltag, ROUTES.adminSpieltag.path(spieltag.saison_id, spieltag.id), { title: nameOf(spieltag) }),
  );
}

export default async function SpieltagEditorPage({ params }: Props) {
  const view = await findSpieltag(params);
  if (view === null) notFound();
  const { spieltag, saison_status } = view;
  return (
    <SpieltagEditor
      title={nameOf(spieltag)}
      record={{ id: spieltag.id, version: spieltag.version, values: valuesOf(spieltag) }}
      save={saveSpieltag}
      rules={boxRulesOf(saveSpieltag)}
      // A finished season's matchdays take no write (`saison_past`), so the editor opens on one read-only.
      {...(saison_status === "past" ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
