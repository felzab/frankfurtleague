// @vitest-environment jsdom
import { SideActsScope } from "@/kit/SideActs";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import AddressChangesPage from "./page";

import type { FLAddressChangeAdminOpen } from "@/core/generated/client/types";
import type { TableBody } from "@/kit/Table";

const state = vi.hoisted(() => ({ changes: [] as unknown[] }));

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/features/address-change/queries", () => ({ getAddressChanges: () => Promise.resolve({ changes: state.changes }) }));
vi.mock("@/core/auth/guards", () => ({ getAdminSession: () => Promise.resolve({ user: { email: "admin@example.org" } }) }));

const change = (id: string, waits_on: FLAddressChangeAdminOpen["waits_on"]): FLAddressChangeAdminOpen => ({
  id,
  address: `${id}@example.org`,
  email: `${id}.neu@example.org`,
  delivery: null,
  effective_from: null,
  expired: false,
  holder: null,
  valid_until: "2026-11-12T14:12:00Z",
  waits_on,
});

/** The rows the page hands its table, once the changes are read. */
async function rowsOf(changes: readonly FLAddressChangeAdminOpen[]): Promise<TableBody["rows"]> {
  state.changes = [...changes];
  const page = AddressChangesPage() as { props: { list: { content: Promise<{ table: TableBody }> } } };
  return (await page.props.list.content).table.rows;
}

describe("a running change's count of its acts", () => {
  /* The list reads the count to choose between a „⋯“ and a lone button for all its rows: a count short of the acts
     drawn turns a list of two acts a row into one of buttons, or hides a lone ending behind a menu of one entry. */
  it("is the number of acts the row draws, with its fresh link and without", async () => {
    // A rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
    const rows = await rowsOf([change("anna", "new_address"), change("berta", "previous_address")]);

    const counts: Array<{ said: number | undefined; drawn: number }> = [];
    for (const row of rows) {
      const { unmount } = render(<SideActsScope folds>{row.acts}</SideActsScope>);
      await userEvent.click(screen.getByRole("button", { name: COPY.template.more }));
      counts.push({ said: row.sideActs, drawn: within(screen.getByRole("menu")).getAllByRole("menuitem").length });
      unmount();
    }
    expect(new Set(counts.map(({ said }) => said))).toStrictEqual(new Set([1, 2]));
    for (const { said, drawn } of counts) expect(said).toBe(drawn);
  });
});
