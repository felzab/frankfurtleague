import { ListPage } from "@/kit/ListPage";

import { judgeAdminRequest } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getBanList } from "@/features/ban-list/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { enterBan } from "./banActs";
import { BanFields } from "./BanFields";
import { LiftBan } from "./LiftBan";

import type { FLBanDurationSaisons, FLBanListEntry } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

const WORDS = COPY.admin.banList;
const ENTER = COPY.shared.withObject(WORDS.object, "enter");

/**
 * How many seasons a ban runs, which the dialog states ahead of the act; checked against the bound
 * `fl_backend/app/shared/schemas/bounds.py :: BAN_DURATION_SAISONS` publishes, so the backend moving it fails the type
 * check here.
 */
const BAN_SAISONS = 5 satisfies FLBanDurationSaisons;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminBanList, ROUTES.adminBanList.path());
}

/** The table's head, drawn while the rows are read and over them once they are. */
const HEAD: TableHead = {
  nameLabel: COPY.signIn.address,
  columns: [
    { key: "reason", label: COPY.admin.spiel.reason, hideOnPhone: true, width: "line", cut: true },
    { key: "until", label: COPY.admin.team.linkValidUntil, narrow: true, width: "date" },
    { key: "enteredOn", label: COPY.admin.facts.enteredOn, hideOnPhone: true, width: "date" },
  ],
  acts: [COPY.shared.verb.remove],
};

/** The address the page was drawn for; the list's own read turns a refused session away to the sign-in. */
async function readHolder() {
  const judged = await judgeAdminRequest();
  return "session" in judged ? judged.session.user.email : "";
}

/** One ban's row, opening nothing: its address, the Grund cut at its column, the last season it covers, and its lift. */
const rowOf = (ban: FLBanListEntry, holder: string): TableRow => ({
  id: ban.id,
  name: { record: ban.address },
  words: `${ban.address} ${ban.ban_reason}`,
  cells: {
    reason: { record: ban.ban_reason },
    until: COPY.shared.saisonName(ban.barred_until_saison_id),
    enteredOn: { record: formatDate(dayOf(ban.created_at)) },
  },
  acts: (
    <LiftBan
      id={ban.id}
      address={ban.address}
      reason={ban.ban_reason}
      holder={holder}
    />
  ),
});

async function readBans(holder: Promise<string>) {
  const [{ ban_list, count_total }, address] = await Promise.all([getBanList(), holder]);
  return {
    cut: count_total > ban_list.length ? WORDS.cut : null,
    table: {
      label: ROUTES.adminBanList.title,
      rows: ban_list.map((ban) => rowOf(ban, address)),
      empty: { kind: "none", plural: WORDS.plural, glyph: "banList" } as const,
    },
  };
}

/** The bans the league holds: searched over the address and the Grund on the page, a new one entered in the dialog over the list. */
export default function BanListPage() {
  const holder = readHolder();
  const bans = readBans(holder);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminBanList" } }}
      create={{
        label: ENTER,
        act: holder.then((address) => ({
          title: ENTER,
          act: { verb: "enter", object: WORDS.object },
          action: enterBan,
          consequence: WORDS.consequence,
          facts: [{ label: WORDS.duration, value: WORDS.durationSaisons(BAN_SAISONS) }],
          touch: { holder: address },
          children: <BanFields />,
        })),
      }}
      notice={bans.then(({ cut }) => cut)}
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, wait: 3, content: bans }}
    />
  );
}
