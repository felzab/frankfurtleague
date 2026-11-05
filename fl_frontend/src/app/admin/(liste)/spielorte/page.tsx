import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { formatEuro } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getSpielorte } from "@/features/spielorte/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { spielortAnlegen } from "../../spielortAnlegen";
import { SpielortFelder } from "../../SpielortFelder";
import { SPIELORT_REGELN } from "../../spielortRegeln";

import type { FLSpielort } from "@/core/generated/client/types";
import type { TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.spielort;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminSpielorte, ROUTES.adminSpielorte.path());
}

/** One venue's row: its name, „Stillgelegt“ and muted once retired, its street and its price. */
const zeile = (ort: FLSpielort): TableRow => ({
  id: ort.id,
  name: { record: ort.name },
  // No `href` while no venue page answers at `ROUTES.adminSpielort`: a row linking there would open the
  // not-found page. The record page brings the link back.
  ...(ort.inactive_since === null ? {} : { chip: { tone: "neutral" as const, label: WORDS.retired }, muted: true }),
  cells: {
    adresse: WORDS.strasseWithHausnummer(ort.address.strasse, ort.address.hausnummer),
    mietpreis: { record: formatEuro(ort.default_mietpreis) },
  },
});

/** The league's venues: searched on the page, a new one created in the dialog over the list. */
export default function SpielortePage() {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSpielorte" } }}
      create={{
        title: COPY.shared.withObject(WORDS.object, "create"),
        act: { verb: "create", object: WORDS.object },
        action: spielortAnlegen,
        children: <SpielortFelder regeln={SPIELORT_REGELN} />,
      }}
      list={{ kind: "table", search: { label: WORDS.search }, content: readSpielorte() }}
    />
  );
}

async function readSpielorte() {
  // Retired included: the list will be the one way into a retired venue's page.
  const { spielorte } = await getSpielorte({ include_inactive: true });
  return {
    table: {
      label: ROUTES.adminSpielorte.title,
      nameLabel: COPY.shared.name,
      columns: [
        { key: "adresse", label: WORDS.address, hideOnPhone: true },
        { key: "mietpreis", label: WORDS.mietpreis, figures: true },
      ],
      rows: spielorte.map(zeile),
      empty: { kind: "none", plural: ROUTES.adminSpielorte.title, glyph: "spielorte" } as const,
    },
  };
}
