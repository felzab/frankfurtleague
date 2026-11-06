import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { requires } from "@/core/action";
import { SpieltagePatchSpieltagBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSpieltag } from "@/features/spieltage/queries";
import { spieltagLabel } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import { saveSpieltag } from "./saveSpieltag";
import { SpieltagEditor } from "./SpieltagEditor";
import { valuesOf } from "./spieltagValues";

import type { FLSpieltagAdmin, FLSpieltagAdminResponse } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spieltage/[spieltag]">;

/** The matchday write's two dates, each required where its schema takes no empty one. */
const REQUIRED = {
  start: requires(SpieltagePatchSpieltagBody.shape.start, null),
  end: requires(SpieltagePatchSpieltagBody.shape.end, null),
};

/** One read of the matchday by its id, its editor's one view read, for the tab's title and the page alike. */
const read = cache(getAdminSpieltag);

/**
 * The matchday the address names, as every season page reads its record: `null` for a malformed id, for none by it,
 * and for one of another season.
 */
async function findSpieltag(params: Props["params"]): Promise<FLSpieltagAdminResponse | null> {
  const spieltag = await objectIdParamOf(params, "spieltag");
  const { saison } = await params;
  const view = spieltag === null ? null : await read(spieltag);
  return view === null || view.spieltag.saison_id !== saison ? null : view;
}

async function readSpieltag(params: Props["params"]): Promise<FLSpieltagAdminResponse> {
  const view = await findSpieltag(params);
  if (view === null) notFound();
  return view;
}

/** A matchday is named as its tab in the Spiele list names it. */
const nameOf = (spieltag: FLSpieltagAdmin) =>
  spieltagLabel({ phase: spieltag.saison_phase, ordinal: spieltag.position, countInPhase: spieltag.count_spieltage_in_phase });

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findSpieltag(params), ({ spieltag }) =>
    pageMetadata(parent, ROUTES.adminSpieltag, ROUTES.adminSpieltag.path(spieltag.saison_id, spieltag.id), { title: nameOf(spieltag) }),
  );
}

/** A matchday's editor, on its one read by id and its write on the version it was read at. */
export default function SpieltagEditorPage({ params }: Props) {
  return (
    <EditorShell
      wait={{ sections: [[{ columns: 2, width: "C10" }]] }}
      editor={readEditor(params)}
    />
  );
}

async function readEditor(params: Props["params"]) {
  const { spieltag, saison_status } = await readSpieltag(params);
  return (
    <SpieltagEditor
      title={nameOf(spieltag)}
      record={{ id: spieltag.id, version: spieltag.version, values: valuesOf(spieltag) }}
      save={saveSpieltag}
      required={REQUIRED}
      // A finished season's matchdays take no write (`saison_past`), so the editor opens on one read-only.
      {...(saison_status === "past" ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
