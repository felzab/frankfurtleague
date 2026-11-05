import { DateField } from "@/kit/DateField";
import { FieldPair } from "@/kit/FieldPair";
import { ListPage } from "@/kit/ListPage";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { dayOf, formatPeriod } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { createSaison } from "@/features/saisons/createSaison";
import { nextSaisonOf } from "@/features/saisons/nextSaison";
import { getAdminSaisons } from "@/features/saisons/queries";
import { CREATE_REQUIRED } from "@/features/saisons/required";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { pageMetadata } from "@/shared/utils/metadata";

import type { FLSaisonAdmin } from "@/core/generated/client/types";
import type { TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.saison;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminSaisons, ROUTES.adminSaisons.path());
}

/** One season's row: its name with where it stands, its span, opening its editor. */
const rowOf = (saison: FLSaisonAdmin): TableRow => ({
  id: saison.id,
  name: COPY.shared.saisonName(saison.id),
  href: ROUTES.adminSaison.path(saison.id),
  chip: saisonChipOf(saison),
  cells: {
    zeitraum: { record: formatPeriod(dayOf(saison.start_date), dayOf(saison.end_date)) },
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
      columns: [{ key: "zeitraum", label: WORDS.zeitraum }],
      rows: saisons.toReversed().map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSaisons.title, glyph: "saisons" } as const,
    },
  };
}
