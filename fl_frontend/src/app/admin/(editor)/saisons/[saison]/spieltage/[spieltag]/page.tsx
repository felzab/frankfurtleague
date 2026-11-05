import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { SpieltagePatchSpieltagBody } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { getAdminSpieltag } from "@/features/spieltage/queries";
import { spieltagLabel } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import { saveSpieltag } from "./saveSpieltag";
import { SpieltagEditor } from "./SpieltagEditor";
import { valuesOf } from "./spieltagValues";

import type { FLSpieltagAdmin } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spieltage/[spieltag]">;

/** The matchday write's two dates, each required where its schema takes no empty one. */
const REQUIRED = {
  beginn: !SpieltagePatchSpieltagBody.shape.beginn.safeParse(null).success,
  ende: !SpieltagePatchSpieltagBody.shape.ende.safeParse(null).success,
};

/** One read of the matchday by its id, its editor's one view read, for the tab's title and the page alike. */
const read = cache(getAdminSpieltag);

/**
 * The matchday the address names, as every season page reads its record: not-found for a malformed id, for none by
 * it, and for one of another season, the tab's title included.
 */
async function readSpieltag(params: Props["params"]): Promise<FLSpieltagAdmin> {
  const spieltag = await read(await resolveObjectIdParam(params, "spieltag"));
  const { saison } = await params;
  if (spieltag === null || spieltag.saison_id !== saison) notFound();
  return spieltag;
}

/** A matchday is named as its tab in the Spiele list names it. */
const nameOf = (spieltag: FLSpieltagAdmin) =>
  spieltagLabel({ phase: spieltag.saison_phase, ordinal: spieltag.position, countInPhase: spieltag.count_in_phase });

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const spieltag = await readSpieltag(params);
  return pageMetadata(parent, ROUTES.adminSpieltag, ROUTES.adminSpieltag.path(spieltag.saison_id, spieltag.id), {
    title: nameOf(spieltag),
  });
}

/** A matchday's editor, on its one read by id and its write on the version it was read at. */
export default function SpieltagEditorPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

async function readEditor(params: Props["params"]) {
  const spieltag = await readSpieltag(params);
  return (
    <SpieltagEditor
      title={nameOf(spieltag)}
      record={{ id: spieltag.id, version: spieltag.version, values: valuesOf(spieltag) }}
      save={saveSpieltag}
      required={REQUIRED}
    />
  );
}
