import { ListPage } from "@/kit/ListPage";
import { ACTIVE_CHIP, RETIRED_CHIP } from "@/kit/stateChips";

import { COPY } from "@/core/copy";
import { formatEuro } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getSpielorte } from "@/features/spielorte/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { createSpielort } from "../../createSpielort";
import { SpielortFields } from "../../SpielortFields";
import { SPIELORT_RULES } from "../../spielortRules";

import type { FLSpielort } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.spielort;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminSpielorte, ROUTES.adminSpielorte.path());
}

/** One venue's row, opening its editor: its name, „Aktiv“, or „Stillgelegt“ and muted once retired, its street and its price. */
const rowOf = (spielort: FLSpielort): TableRow => ({
  id: spielort.id,
  name: { record: spielort.name },
  href: ROUTES.adminSpielort.path(spielort.id),
  ...(spielort.inactive_since === null ? { chip: ACTIVE_CHIP } : { chip: RETIRED_CHIP, muted: true }),
  cells: {
    adresse: WORDS.streetWithHouseNumber(spielort.address.street, spielort.address.house_number),
    mietpreis: { record: formatEuro(spielort.default_mietpreis) },
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
        action: createSpielort,
        children: <SpielortFields rules={SPIELORT_RULES} />,
      }}
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, wait: 8, content: readSpielorte() }}
    />
  );
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.admin.schiedsrichter.state },
  columns: [
    { key: "adresse", label: WORDS.address, hideOnPhone: true, width: "line", cut: true },
    { key: "mietpreis", label: WORDS.mietpreis, figures: true, narrow: true },
  ],
};

async function readSpielorte() {
  // Retired included: the list is the one way into a retired venue's page, whose danger box brings it back.
  const { spielorte } = await getSpielorte({ include_inactive: true });
  return {
    table: {
      label: ROUTES.adminSpielorte.title,
      rows: spielorte.map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSpielorte.title, glyph: "spielorte" } as const,
    },
  };
}
