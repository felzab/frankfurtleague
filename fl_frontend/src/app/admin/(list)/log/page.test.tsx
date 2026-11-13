import { beforeEach, describe, expect, it, vi } from "vitest";

import { byOptions } from "@/features/action-log/filters";

import ActionLogPage from "./page";

import type { FLActionLogFilterPayload, FLActionLogListResponse } from "@/core/generated/client/types";
import type { ListMore, ListSearch } from "@/kit/ListTable";
import type { TableBody } from "@/kit/Table";

const state = vi.hoisted(() => ({ asked: [] as FLActionLogFilterPayload[], answer: null as unknown }));

vi.mock("@/features/action-log/queries", () => ({
  getActionLog: (params: FLActionLogFilterPayload) => {
    state.asked.push(params);
    return state.answer instanceof Error ? Promise.reject(state.answer) : Promise.resolve(state.answer);
  },
}));

vi.mock("@/features/action-log/actions", () => ({ loadActionLog: () => Promise.resolve({ ok: true, value: { rows: [], cursor: null } }) }));

const answer = (overrides: Partial<FLActionLogListResponse>): FLActionLogListResponse => ({
  action_log: [],
  by_options: ["anna@example.de", "system"],
  cursor: null,
  ...overrides,
});

type Drawn = {
  props: {
    filters: Promise<unknown>;
    list: { search: ListSearch; content: Promise<{ table: TableBody; more: ListMore }> };
  };
};

const pageOf = (searchParams: Record<string, string | string[]>) =>
  ActionLogPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) } as Parameters<typeof ActionLogPage>[0]) as Drawn;

async function read(searchParams: Record<string, string | string[]>) {
  const page = pageOf(searchParams);
  // Both, as the list template awaits both: the toolbar's filters and the list come of one read.
  const [, content] = await Promise.all([page.props.filters, page.props.list.content]);
  return content;
}

beforeEach(() => {
  state.asked = [];
});

describe("the Protokoll's reads", () => {
  /* A next page read past the filters would run on with rows the page says it left out. */
  it("carries the address's filters into every later read", async () => {
    state.answer = answer({ cursor: "a".repeat(24) });
    const id = byOptions(["system"]).at(0)?.id ?? "";
    const { more } = await read({ by: id, type: "ban", time: "30-days" });
    expect(more.carry).toStrictEqual({ by: "system", type: "ban", time: "30-days" });
  });

  /* The filter cannot show a value it does not offer, so honouring one would empty a list under a select reading „Alle“. */
  it("reads the whole log for a `by` it does not hold", async () => {
    state.answer = answer({});
    const { more, table } = await read({ by: "gone@example.de" });
    expect(state.asked.map(({ by }) => by)).toStrictEqual([null]);
    expect(more.carry).toStrictEqual({});
    expect(table.empty.kind).toBe("none");
  });

  /* An outage answering „Noch keine Einträge.“ would read as a log with nothing in it. */
  it("leaves a failed read to the boundary", async () => {
    const failure = new Error("read failed");
    state.answer = failure;
    await expect(read({})).rejects.toBe(failure);
  });
});
