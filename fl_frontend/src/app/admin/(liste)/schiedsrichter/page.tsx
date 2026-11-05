import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { confirmationStateOf } from "@/features/schiedsrichter/confirmationState";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { createSchiedsrichter } from "./createSchiedsrichter";
import { SchiedsrichterFields } from "./SchiedsrichterFields";

import type { FLSchiedsrichter } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.schiedsrichter;
const OBJECT = COPY.shared.schiedsrichter;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminSchiedsrichter, ROUTES.adminSchiedsrichter.path());
}

/**
 * The chip after a referee's name: „Stillgelegt“ once retired, else where their entry stands, a confirmed one
 * carrying none, since a confirmed entry is what the list expects.
 */
function chipOf(referee: FLSchiedsrichter): ChipProps | undefined {
  if (referee.inactive_since !== null) return { tone: "neutral", label: COPY.admin.spielort.retired };
  switch (confirmationStateOf(referee)) {
    case "confirmed":
      return undefined;
    case "objected":
      return { tone: "danger", label: SERVER_COPY.schiedsrichterConfirmation.objected };
    case "unanswered":
    case "unasked":
      return { tone: "warn", label: WORDS.unconfirmed };
  }
}

/** One referee's row, opening their editor: the name with its chip, the address and the phone. */
function rowOf(referee: FLSchiedsrichter): TableRow {
  const chip = chipOf(referee);
  return {
    id: referee.id,
    // A hand-written row may hold no name; it is still a person in the league, found by its address.
    name: referee.name === null ? COPY.shared.noValue : { record: referee.name },
    href: ROUTES.adminSchiedsrichterRecord.path(referee.id),
    ...(chip === undefined ? {} : { chip }),
    muted: referee.inactive_since !== null,
    cells: {
      email: referee.kontakt.email === null ? COPY.shared.noValue : { record: referee.kontakt.email },
      telefon: referee.kontakt.telefon === null ? COPY.shared.noValue : { record: referee.kontakt.telefon },
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
      list={{ kind: "table", search: { label: WORDS.search }, content: readSchiedsrichter() }}
    />
  );
}

async function readSchiedsrichter() {
  // Retired included: the list is the one way into a retired referee's page, whose danger box brings them back.
  const { schiedsrichter } = await getSchiedsrichter({ include_inactive: true });
  return {
    table: {
      label: ROUTES.adminSchiedsrichter.title,
      nameLabel: COPY.shared.name,
      columns: [
        { key: "email", label: COPY.signIn.address, hideOnPhone: true },
        { key: "telefon", label: COPY.account.entries.facts.phone },
      ],
      rows: schiedsrichter.map(rowOf),
      empty: { kind: "none", plural: ROUTES.adminSchiedsrichter.title, glyph: "schiedsrichter" } as const,
    },
  };
}
