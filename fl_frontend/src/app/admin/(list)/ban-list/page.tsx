import { boxRulesOf } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { BAN_DURATION_SAISONS } from "@/core/bounds";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getBanList } from "@/features/ban-list/queries";
import { ListPage } from "@/kit/ListPage";
import { RowAct } from "@/kit/RowAct";
import { pageMetadata } from "@/shared/utils/metadata";

import { enterBan, liftBan } from "./banActs";
import { BanFields } from "./BanFields";

import type { FLBanListRow } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";

const WORDS = ADMIN_COPY.banList;
const ENTER = COPY.shared.withObject(COPY.shared.ban, "enter");

export const metadata = pageMetadata(ROUTES.adminBanList);

/**
 * The table's head. Every column is secondary, and a row opens nothing, so on a phone the row's line says what the
 * columns would.
 */
const HEAD: TableHead = {
  nameLabel: COPY.shared.emailAddress,
  columns: [
    { key: "reason", label: COPY.shared.reason, hideOnPhone: true, onLine: "value", width: "excerpt", cut: true },
    { key: "until", label: ADMIN_COPY.banList.until, hideOnPhone: true, onLine: "labelled", width: "word" },
    { key: "enteredOn", label: ADMIN_COPY.facts.enteredOn, hideOnPhone: true, onLine: "labelled", width: "date" },
  ],
};

/**
 * One ban's row, opening nothing: its address, the Grund cut at its column, the last season it covers, the day it was
 * entered, and its lift; on a phone the three facts stand on the row's line.
 */
const rowOf = (ban: FLBanListRow, holder: string): TableRow => {
  const until = COPY.shared.saisonNameBound(ban.barred_until_saison_id);
  return {
    id: ban.id,
    name: { record: ban.address, address: true },
    words: `${ban.address} ${ban.ban_reason}`,
    cells: {
      reason: { record: ban.ban_reason },
      until,
      enteredOn: { record: formatDate(dayOf(ban.created_at)) },
    },
    acts: (
      <RowAct
        verb="remove"
        subject={COPY.shared.ban}
        consequence={WORDS.liftConsequence}
        facts={[
          { label: COPY.shared.emailAddress, value: { record: ban.address, address: true } },
          { label: COPY.shared.reason, value: { record: ban.ban_reason } },
        ]}
        run={liftBan}
        id={ban.id}
        holder={holder}
      />
    ),
  };
};

async function readBans(holder: Promise<string>) {
  const [{ ban_list }, address] = await Promise.all([getBanList(), holder]);
  return {
    table: {
      label: ROUTES.adminBanList.title,
      rows: ban_list.map((ban) => rowOf(ban, address)),
      empty: { kind: "none", plural: WORDS.plural, glyph: "banList" } as const,
    },
  };
}

/** The bans the league holds: searched over the address and the Grund on the page, a new one entered in the dialog over the list. */
export default function BanListPage() {
  const holder = getAdminHolder();
  const bans = readBans(holder);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminBanList" } }}
      create={holder.then((address) => ({
        title: ENTER,
        act: { verb: "enter", object: COPY.shared.ban },
        run: enterBan,
        rules: boxRulesOf(enterBan),
        consequence: WORDS.consequence,
        facts: [
          { label: WORDS.duration, value: WORDS.durationSaisons(BAN_DURATION_SAISONS) },
          { label: ADMIN_COPY.facts.mailTo, value: WORDS.mailTo },
        ],
        touch: { holder: address },
        children: <BanFields />,
      }))}
      list={{ kind: "table", search: { label: WORDS.search }, head: HEAD, content: bans }}
    />
  );
}
