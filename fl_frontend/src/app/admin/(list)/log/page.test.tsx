import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it, vi } from "vitest";

import { byOptions } from "@/features/action-log/filters";

import type { FLActionLogFilterPayload, FLActionLogListResponse } from "@/core/generated/client/types";
import type { ListMore, ListSearch } from "@/kit/ListTable";
import type { TableBody } from "@/kit/Table";

/** What the backend answers the log's read with: a page of it, or a failure. */
const state = { answer: null as unknown };

// A server function, which the page hands the list's „Mehr laden“ and a client reaches over the network: no case presses it.
vi.mock("@/features/action-log/actions", () => ({ loadActionLog: () => Promise.resolve({ ok: true, value: { rows: [], cursor: null } }) }));

// The log's read, through the real guard, query and generated call.
const backend = serveBackend(({ method, path }) => (method === "POST" && path === "/action_log/view" ? state.answer : undefined));
// An administrator's session, made by passkey, which the read's guard admits.
signedInRequest();

const { default: ActionLogPage } = await import("./page");

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

/** The filters each read of the log posted, in the order the page sent them. */
const askedFor = () => backend.sent.map(({ body }) => body as FLActionLogFilterPayload);

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
    expect(askedFor().map(({ by }) => by)).toStrictEqual([null]);
    expect(more.carry).toStrictEqual({});
    expect(table.empty.kind).toBe("none");
  });

  /* An outage answering „Noch keine Einträge.“ would read as a log with nothing in it. */
  it("leaves a failed read to the boundary", async () => {
    state.answer = refusal("database_failed", { status: 503 });
    await expect(read({})).rejects.toMatchObject({ name: "APIBadStatusError", statusCode: 503, serverErrorCode: "database_failed" });
  });
});
