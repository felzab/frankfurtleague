import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { refereeChip } from "@/features/schiedsrichter/confirmationState";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { createSchiedsrichter } from "./createSchiedsrichter";
import { SchiedsrichterFields } from "./SchiedsrichterFields";

import type { FLSchiedsrichter } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.schiedsrichter;
const OBJECT = COPY.shared.schiedsrichter;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminSchiedsrichter, ROUTES.adminSchiedsrichter.path());
}

/** One referee's row, opening their editor: the name with where the entry stands, „Bestätigt“ once confirmed, the address and the phone. */
function rowOf(referee: FLSchiedsrichter): TableRow {
  return {
    id: referee.id,
    name: { record: referee.name },
    href: ROUTES.adminSchiedsrichterRecord.path(referee.id),
    chip: refereeChip(referee),
    muted: referee.inactive_since !== null,
    cells: {
      email: referee.kontakt.email === null ? COPY.shared.noValue : { record: referee.kontakt.email },
      phone: referee.kontakt.phone === null ? COPY.shared.noValue : { record: referee.kontakt.phone },
    },
  };
}

/** The league's referees: searched on the page, a new one entered, and so asked, in the dialog over the list. */
export default function SchiedsrichterPage() {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSchiedsrichter" } }}
      create={{
        title: COPY.shared.withObject(OBJECT, "create"),
        act: { verb: "create", object: OBJECT },
        action: createSchiedsrichter,
        children: <SchiedsrichterFields />,
      }}
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, content: readSchiedsrichter() }}
    />
  );
}

const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.admin.schiedsrichter.state },
  columns: [
    { key: "email", label: COPY.signIn.address, hideOnPhone: true, width: "line", cut: true },
    { key: "phone", label: COPY.shared.facts.phone, hideOnPhone: true, width: "phone" },
  ],
};

async function readSchiedsrichter() {
  // Retired included: the list is the one way into a retired referee's page, whose danger box brings them back.
  const { schiedsrichter } = await getSchiedsrichter({ include_inactive: true });
  return {
    table: {
      label: ROUTES.adminSchiedsrichter.title,
      rows: schiedsrichter.map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSchiedsrichter.title, glyph: "schiedsrichter" } as const,
    },
  };
}
