import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { refereeChip } from "@/features/schiedsrichter/confirmationState";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";

import { createSchiedsrichter } from "./createSchiedsrichter";
import { SchiedsrichterFields } from "./SchiedsrichterFields";

import type { FLSchiedsrichterAdminRow } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.schiedsrichter;
const OBJECT = COPY.shared.schiedsrichter;

export const metadata = pageMetadata(ROUTES.adminSchiedsrichter);

/** One referee's row, opening their editor: the name with where the entry stands, „Bestätigt“ once confirmed, the address and the phone. */
function rowOf(referee: FLSchiedsrichterAdminRow): TableRow {
  return {
    id: referee.id,
    name: { record: referee.name },
    href: ROUTES.adminSchiedsrichterRecord.path(referee.id),
    chip: refereeChip(referee),
    muted: referee.inactive_since !== null,
    cells: {
      email: { record: referee.kontakt.email },
      phone: referee.kontakt.phone === null ? COPY.shared.noValue : { record: referee.kontakt.phone },
    },
  };
}

/**
 * The league's referees: searched on the page, a new one entered, and so asked, in the dialog over the list, behind the
 * passkey touch, since the entry hands the referee's area to the address it stores, as the editor's save does.
 */
export default function SchiedsrichterPage() {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminSchiedsrichter" } }}
      create={getAdminHolder().then((holder) => ({
        title: COPY.shared.withObject(OBJECT, "create"),
        act: { verb: "create", object: OBJECT },
        run: createSchiedsrichter,
        touch: { holder },
        children: <SchiedsrichterFields />,
      }))}
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, content: readSchiedsrichter() }}
    />
  );
}

const HEAD: TableHead = {
  nameLabel: COPY.shared.name,
  state: { label: COPY.shared.facts.state },
  columns: [
    { key: "email", label: COPY.shared.emailAddress, hideOnPhone: true, width: "line", cut: true },
    { key: "phone", label: COPY.shared.facts.phone, hideOnPhone: true, width: "phone" },
  ],
};

async function readSchiedsrichter() {
  // Retired included: the list is the one way into a retired referee's page, whose danger box brings them back.
  const { schiedsrichter } = await getSchiedsrichter();
  return {
    table: {
      label: ROUTES.adminSchiedsrichter.title,
      rows: schiedsrichter.map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSchiedsrichter.title, glyph: "schiedsrichter" } as const,
    },
  };
}
