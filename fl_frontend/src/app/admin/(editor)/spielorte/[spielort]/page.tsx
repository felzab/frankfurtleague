import { cache } from "react";
import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { ROUTES } from "@/core/routes";
import { getSpielort } from "@/features/spielorte/queries";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { saveSpielort } from "./saveSpielort";
import { reactivateSpielort, retireSpielort } from "./spielortActs";
import { SpielortEditor } from "./SpielortEditor";
import { valuesOf } from "./spielortValues";

import type { Metadata } from "next";

type Props = PageProps<"/admin/spielorte/[spielort]">;

const read = cache(getSpielort);

/** The venue the address names, retired or not: `null` for a malformed id and for one no venue holds. */
async function findSpielort(params: Props["params"]) {
  const id = await adminIdParamOf(params, "spielort");
  return id === null ? null : read(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findSpielort(params), (spielort) =>
    pageMetadata(ROUTES.adminSpielort, ROUTES.adminSpielort.path(spielort.id), { title: { record: spielort.name } }),
  );
}

export default async function SpielortEditorPage({ params }: Props) {
  const spielort = await findSpielort(params);
  if (spielort === null) notFound();
  return (
    <SpielortEditor
      title={{ record: spielort.name }}
      record={{ id: spielort.id, version: spielort.version, values: valuesOf(spielort) }}
      save={saveSpielort}
      rules={boxRulesOf(saveSpielort)}
      retired={spielort.inactive_since !== null}
      retire={retireSpielort}
      reactivate={reactivateSpielort}
    />
  );
}
