import { describe, expect, it, vi } from "vitest";

import { textOf } from "@/core/copy";

import BanListPage from "./page";

import type { Words } from "@/core/copy";
import type { FLBanListRow } from "@/core/generated/client/types";
import type { TableHead, TableRow } from "@/kit/Table";

const BAN: FLBanListRow = {
  id: "64b0000000000000000000b1",
  address: "max@example.org",
  ban_reason: "Beleidigungen am Spielfeldrand",
  barred_until_saison_id: "2027",
  created_at: "2026-11-12",
};

vi.mock("@/features/ban-list/queries", () => ({ getBanList: async () => ({ ban_list: [BAN] }) }));
vi.mock("@/core/auth/guards", () => ({ getAdminSession: async () => ({ user: { email: "admin@example.org" } }) }));
vi.mock("./banActs", () => ({ enterBan: () => undefined, liftBan: () => undefined }));

type Drawn = { props: { list: { head: TableHead; content: Promise<{ table: { rows: readonly TableRow[] } }> } } };

// A phone leaves every column of the list out and its rows open nothing, so a fact its line drops is lost there, while
// every desktop pass shows the column.
describe("a ban's row on a phone", () => {
  it("carries on its line every fact its hidden columns hold", async () => {
    const { head, content } = (BanListPage() as unknown as Drawn).props.list;
    const [row] = (await content).table.rows;
    const line = row?.phoneLine === undefined ? "" : textOf(row.phoneLine as Words);

    const hidden = head.columns.filter((column) => column.hideOnPhone === true);
    expect(hidden).not.toHaveLength(0);
    for (const { key } of hidden) expect(line).toContain(textOf(row?.cells[key] as Words));
  });
});
