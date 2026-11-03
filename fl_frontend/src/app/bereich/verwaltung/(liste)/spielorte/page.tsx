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

const WORTE = COPY.verwaltung.spielort;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.verwaltungSpielorte, ROUTES.verwaltungSpielorte.path());
}

/** One venue's row: its name, „Stillgelegt“ and muted once retired, its street and its price. */
const zeile = (ort: FLSpielort): TableRow => ({
  id: ort.id,
  name: { record: ort.name },
  // No `href` while no venue page answers at `ROUTES.verwaltungSpielort`: a row linking there would open the
  // not-found page. The record page brings the link back.
  ...(ort.inactive_since === null ? {} : { chip: { tone: "neutral" as const, label: WORTE.retired }, muted: true }),
  cells: {
    adresse: WORTE.strasseWithHausnummer(ort.address.strasse, ort.address.hausnummer),
    mietpreis: { record: formatEuro(ort.default_mietpreis) },
  },
});

/** The league's venues: searched on the page, a new one created in the dialog over the list. */
export default function SpielortePage() {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "verwaltungSpielorte" } }}
      create={{
        title: COPY.shared.withObject(WORTE.object, "create"),
        act: { verb: "create", object: WORTE.object },
        action: spielortAnlegen,
        children: <SpielortFelder regeln={SPIELORT_REGELN} />,
      }}
      list={{ kind: "table", search: { label: WORTE.search }, content: readSpielorte() }}
    />
  );
}

async function readSpielorte() {
  // Retired included: the list will be the one way into a retired venue's page.
  const { spielorte } = await getSpielorte({ include_inactive: true });
  return {
    table: {
      label: ROUTES.verwaltungSpielorte.title,
      nameLabel: WORTE.name,
      columns: [
        { key: "adresse", label: WORTE.address, hideOnPhone: true },
        { key: "mietpreis", label: WORTE.mietpreis, figures: true },
      ],
      rows: spielorte.map(zeile),
      empty: { kind: "none", plural: ROUTES.verwaltungSpielorte.title, glyph: "spielorte" } as const,
    },
  };
}
