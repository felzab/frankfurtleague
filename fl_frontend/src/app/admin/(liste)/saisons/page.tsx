import { DateField } from "@/kit/DateField";
import { FieldPair } from "@/kit/FieldPair";
import { ListPage } from "@/kit/ListPage";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { dayOf, formatDatum, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { createSaison } from "@/features/saisons/createSaison";
import { nextSaisonOf } from "@/features/saisons/nextSaison";
import { getAdminSaisons } from "@/features/saisons/queries";
import { CREATE_REQUIRED } from "@/features/saisons/required";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { pageMetadata } from "@/shared/utils/metadata";

import type { FLSaisonAdminListed } from "@/core/generated/client/types";
import type { TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.saison;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminSaisons, ROUTES.adminSaisons.path());
}

/** A count, or the glyph for no value where there is none yet. */
const countOf = (count: number) => (count === 0 ? COPY.shared.noValue : { record: formatNumber(count) });

/** One season's row: its name with where it stands, its two days, its clubs and its matches, opening its editor. */
const rowOf = (saison: FLSaisonAdminListed): TableRow => ({
  id: saison.id,
  name: COPY.shared.saisonName(saison.id),
  href: ROUTES.adminSaison.path(saison.id),
  chip: saisonChipOf(saison),
  cells: {
    beginn: { record: formatDatum(dayOf(saison.start_date)) },
    ende: { record: formatDatum(dayOf(saison.end_date)) },
    teams: countOf(saison.count_teams),
    // The draw's own count: no match is added or removed outside it, and an undrawn season has none.
    spiele: countOf(saison.spielplan?.spiele ?? 0),
  },
});

/** Every season, the newest first, and a new one created in the dialog over the list, a year on from the newest. */
export default function SaisonsPage() {
  const read = getAdminSaisons();
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSaisons" } }}
      create={{
        title: COPY.shared.withObject(COPY.shared.saison, "create"),
        act: { verb: "create", object: COPY.shared.saison },
        action: createSaison,
        children: <CreateFields read={read} />,
      }}
      list={{ kind: "table", content: readSaisons(read) }}
    />
  );
}

/** The create dialog's boxes, starting from the next season the newest suggests. */
async function CreateFields({ read }: { read: ReturnType<typeof getAdminSaisons> }) {
  // Served oldest first, by id.
  const next = nextSaisonOf((await read).saisons.at(-1));
  return (
    <>
      <TextField
        label={WORDS.jahr}
        name="id"
        width="C5"
        kind="digits"
        isRequired={CREATE_REQUIRED.id}
        defaultValue={next.id}
      />
      {/* A season's two days are one value, sharing their row at every width. */}
      <FieldPair
        short="both"
        phone="pair">
        <DateField
          label={WORDS.beginn}
          name="start_date"
          isRequired={CREATE_REQUIRED.start}
          defaultValue={next.start}
        />
        <DateField
          label={WORDS.ende}
          name="end_date"
          isRequired={CREATE_REQUIRED.end}
          defaultValue={next.end}
        />
      </FieldPair>
    </>
  );
}

async function readSaisons(read: ReturnType<typeof getAdminSaisons>) {
  const { saisons } = await read;
  return {
    table: {
      label: ROUTES.adminSaisons.title,
      nameLabel: COPY.shared.saison,
      // A phone's row holds the name, its chip and the start beside them, with room to spare at 390 px.
      columns: [
        { key: "beginn", label: WORDS.beginn },
        { key: "ende", label: WORDS.ende, hideOnPhone: true },
        { key: "teams", label: COPY.page.teams, figures: true, hideOnPhone: true },
        { key: "spiele", label: COPY.page.spiele, figures: true, hideOnPhone: true },
      ],
      rows: saisons.toReversed().map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSaisons.title, glyph: "saisons" } as const,
    },
  };
}
