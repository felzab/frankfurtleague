import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { ROUTES } from "@/core/routes";
import { getSpielort } from "@/features/spielorte/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import { SPIELORT_RULES } from "../../../spielortRules";
import { reactivateSpielort, retireSpielort } from "./retireSpielort";
import { saveSpielort } from "./saveSpielort";
import { SpielortEditor } from "./SpielortEditor";
import { valuesOf } from "./spielortValues";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/spielorte/[spielort]">;

/** One read of the venue by its id for the tab's title and the page alike (K230). */
const read = cache(getSpielort);

/** The venue the address names, retired or not: not-found for a malformed id and for one no venue holds. */
async function readSpielort(params: Props["params"]) {
  const spielort = await read(await resolveObjectIdParam(params, "spielort"));
  if (spielort === null) notFound();
  return spielort;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const spielort = await readSpielort(params);
  return pageMetadata(parent, ROUTES.adminSpielort, ROUTES.adminSpielort.path(spielort.id), { title: { record: spielort.name } });
}

/** A venue's editor, on its one read by id and its write on the version it was read at. */
export default function SpielortEditorPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

async function readEditor(params: Props["params"]) {
  const spielort = await readSpielort(params);
  return (
    <SpielortEditor
      title={{ record: spielort.name }}
      record={{ id: spielort.id, version: spielort.version, values: valuesOf(spielort) }}
      save={saveSpielort}
      rules={SPIELORT_RULES}
      retired={spielort.inactive_since !== null}
      retire={retireSpielort}
      reactivate={reactivateSpielort}
    />
  );
}
