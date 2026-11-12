import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";
import { FieldPair, FieldPlaceholder } from "@/kit/FieldPair";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSpielort } from "@/features/spielorte/queries";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { SPIELORT_SAVE_RULES } from "../../../spielortRules";
import { reactivateSpielort, retireSpielort } from "./retireSpielort";
import { saveSpielort } from "./saveSpielort";
import { SpielortEditor } from "./SpielortEditor";
import { valuesOf } from "./spielortValues";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/spielorte/[spielort]">;

/** One read of the venue by its id for the tab's title and the page alike, shared within the request. */
const read = cache(getSpielort);

/** The venue the address names, retired or not: `null` for a malformed id and for one no venue holds. */
async function findSpielort(params: Props["params"]) {
  const id = await adminIdParamOf(params, "spielort");
  return id === null ? null : read(id);
}

async function readSpielort(params: Props["params"]) {
  const spielort = await findSpielort(params);
  if (spielort === null) notFound();
  return spielort;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findSpielort(params), (spielort) =>
    pageMetadata(parent, ROUTES.adminSpielort, ROUTES.adminSpielort.path(spielort.id), { title: { record: spielort.name } }),
  );
}

/** A venue's editor, on its one read by id and its write on the version it was read at. */
export default function SpielortEditorPage({ params }: Props) {
  return (
    <EditorShell
      wait={{
        sections: [
          [
            <FieldPlaceholder key="name" />,
            <FieldPlaceholder
              key="mietpreis"
              holds={5}
              unit={COPY.shared.unit.euro}
            />,
          ],
          [
            <FieldPair key="street">
              <FieldPlaceholder />
              <FieldPlaceholder holds={5} />
            </FieldPair>,
            <FieldPair key="city">
              <FieldPlaceholder
                holds={5}
                figures
              />
              <FieldPlaceholder />
            </FieldPair>,
            "field",
          ],
        ],
        danger: [
          {
            name: COPY.shared.withObject(COPY.admin.spielort.object, "retire"),
            consequence: COPY.admin.spielort.retireConsequence,
            act: COPY.shared.verb.retire,
          },
        ],
      }}
      editor={readEditor(params)}
    />
  );
}

async function readEditor(params: Props["params"]) {
  const spielort = await readSpielort(params);
  return (
    <SpielortEditor
      title={{ record: spielort.name }}
      record={{ id: spielort.id, version: spielort.version, values: valuesOf(spielort) }}
      save={saveSpielort}
      rules={SPIELORT_SAVE_RULES}
      retired={spielort.inactive_since !== null}
      retire={retireSpielort}
      reactivate={reactivateSpielort}
    />
  );
}
