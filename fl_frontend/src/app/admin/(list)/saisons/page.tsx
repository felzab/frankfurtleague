import { boxRulesOf } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate, formatNumber } from "@/core/format";
import { ownKeyOf } from "@/core/ownKeyOf";
import { ROUTES } from "@/core/routes";
import { nextSaisonOf } from "@/features/saisons/nextSaison";
import { getAdminSaisons } from "@/features/saisons/queries";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";

import { CreateFields } from "./CreateFields";
import { createSaison } from "./createSaison";

import type { Copy } from "@/core/copy";
import type { Code, FLSaisonAdminListed } from "@/core/generated/client/types";
import type { ListCreate } from "@/kit/ListPage";
import type { TableHead, TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.saison;

export const metadata = pageMetadata(ROUTES.adminSaisons);

/** A count, or the glyph for no value where there is none yet. */
const countOf = (count: number) => (count === 0 ? COPY.shared.noValue : { record: formatNumber(count) });

/** One season's row: its name with where it stands, its two days, its clubs and its matches, opening its editor. */
const rowOf = (saison: FLSaisonAdminListed): TableRow => ({
  id: saison.id,
  name: COPY.shared.saisonName(saison.id),
  href: ROUTES.adminSaison.path(saison.id),
  chip: saisonChipOf(saison),
  cells: {
    start: { record: formatDate(dayOf(saison.start_date)) },
    end: { record: formatDate(dayOf(saison.end_date)) },
    teams: countOf(saison.count_teams),
    spiele: countOf(saison.count_spiele),
  },
});

/** Every season, the newest first, and the next one created in the dialog over the list, a year on from the newest. */
export default function SaisonsPage() {
  const read = getAdminSaisons();
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSaisons" } }}
      create={readCreate(read)}
      list={{ kind: "table", head: HEAD, content: readSaisons(read) }}
    />
  );
}

/**
 * Why the create cannot run now, by the refusal the read serves for it: never a rule of the page's own. A code the
 * table holds no phrase for means a page older than the API, and so does a planning window's, which locks a draw.
 */
function lockedOf(code: Code): Copy {
  if (!ownKeyOf(WORDS.locks, code)) return WORDS.lockedOtherwise;
  const lock = WORDS.locks[code];
  return typeof lock === "function" ? WORDS.lockedOtherwise : lock;
}

/**
 * The next season's own act, named by the id the backend mints for it, closed while the read says the create would be
 * refused.
 */
async function readCreate(read: ReturnType<typeof getAdminSaisons>): Promise<ListCreate> {
  const { saisons, next_saison_id, refusals } = await read;
  const name = COPY.shared.saisonName(next_saison_id);
  return {
    title: COPY.shared.withObject(name, "create"),
    act: { verb: "create", object: name },
    run: createSaison,
    rules: boxRulesOf(createSaison),
    // Read oldest first, the order `getAdminSaisons` asks for.
    children: <CreateFields next={nextSaisonOf(saisons.at(-1))} />,
    ...(refusals.create === null ? {} : { locked: lockedOf(refusals.create) }),
  };
}

const HEAD: TableHead = {
  nameLabel: COPY.shared.saison,
  state: { label: COPY.shared.facts.state },
  columns: [
    { key: "start", label: WORDS.start, narrow: true, width: "date" },
    { key: "end", label: WORDS.end, hideOnPhone: true, width: "date" },
    { key: "teams", label: COPY.page.teams, figures: true, hideOnPhone: true },
    { key: "spiele", label: COPY.page.spiele, figures: true, hideOnPhone: true },
  ],
};

async function readSaisons(read: ReturnType<typeof getAdminSaisons>) {
  const { saisons } = await read;
  return {
    table: {
      label: ROUTES.adminSaisons.title,
      // Read oldest first, the order `getAdminSaisons` asks for.
      rows: saisons.toReversed().map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSaisons.title, glyph: "saisons" } as const,
    },
  };
}
