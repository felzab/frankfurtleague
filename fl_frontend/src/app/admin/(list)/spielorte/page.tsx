import { boxRulesOf } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { formatEuro } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { createSpielort } from "@/features/spielorte/createSpielort";
import { getSpielorte } from "@/features/spielorte/queries";
import { SpielortFields } from "@/features/spielorte/SpielortFields";
import { ListPage } from "@/kit/ListPage";
import { ACTIVE_CHIP, RETIRED_CHIP } from "@/kit/stateChips";
import { pageMetadata } from "@/shared/utils/metadata";

import type { FLSpielort } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.spielort;

export const metadata = pageMetadata(ROUTES.adminSpielorte);

/** One venue's row, opening its editor: its name, „Aktiv“, or „Stillgelegt“ and muted once retired, its street and its price. */
const rowOf = (spielort: FLSpielort): TableRow => ({
  id: spielort.id,
  name: { record: spielort.name },
  href: ROUTES.adminSpielort.path(spielort.id),
  ...(spielort.inactive_since === null ? { chip: ACTIVE_CHIP } : { chip: RETIRED_CHIP, muted: true }),
  cells: {
    adresse: COPY.shared.address.streetWithHouseNumber(spielort.address.street, spielort.address.house_number),
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
        run: createSpielort,
        rules: boxRulesOf(createSpielort),
        children: <SpielortFields />,
      }}
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, content: readSpielorte() }}
    />
  );
}

const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.shared.facts.state },
  columns: [
    { key: "adresse", label: COPY.shared.address.title, hideOnPhone: true, width: "line", cut: true },
    { key: "mietpreis", label: WORDS.mietpreis, figures: true, narrow: true },
  ],
};

async function readSpielorte() {
  // Retired ones among them: the list is the one way into a retired venue's page, whose danger box brings it back.
  const { spielorte } = await getSpielorte();
  return {
    table: {
      label: ROUTES.adminSpielorte.title,
      rows: spielorte.map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSpielorte.title, glyph: "spielorte" } as const,
    },
  };
}
