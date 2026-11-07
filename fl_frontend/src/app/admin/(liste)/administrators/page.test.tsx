import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import AdministratorsPage from "./page";

import type { FLAddressChangeAdminOpen, FLGrantRow } from "@/core/generated/client/types";
import type { ListCreate } from "@/kit/ListPage";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { TableProps } from "@/kit/Table";
import type { ReactElement } from "react";

const OWNER = "owner@example.org";
const PAST = "2026-01-01T10:00:00Z";
const FUTURE = "2999-01-01T10:00:00Z";

const state = vi.hoisted(() => ({ grants: [] as unknown[], changes: [] as unknown[], reader: "" }));

vi.mock("@/features/grants/schemas", () => ({ GRANT_RULES: { required: { email: true, grant_id: true }, emailMax: 254 } }));
vi.mock("@/features/grants/queries", () => ({
  getGrants: () => Promise.resolve({ grants: state.grants }),
  getAddressChanges: () => Promise.resolve({ changes: state.changes }),
}));
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: () => Promise.resolve({ session: { user: { email: state.reader } } }),
}));
vi.mock("@/features/grants/actions", () => ({
  addAdministrator: () => undefined,
  removeAdministrator: () => undefined,
  startHandover: () => undefined,
  stopAddressChange: () => undefined,
  stopHandover: () => undefined,
}));

const grant = (address: string, overrides: Partial<FLGrantRow> = {}) =>
  ({
    id: address,
    address,
    admin_tier: "administration",
    granted_by: OWNER,
    effective_from: PAST,
    owner_from: null,
    ...overrides,
  }) as FLGrantRow;

const THE_OWNER = grant(OWNER, { admin_tier: "owner" });

const change = (address: string, effective_from: string | null) =>
  ({ id: `change-${address}`, address, email: "neu@example.org", effective_from }) as FLAddressChangeAdminOpen;

type Drawn = {
  props: {
    create: { act: Promise<ListCreate | null> };
    sideAct: { act: Promise<ListCreate | null> };
    list: { content: Promise<ReactElement<{ cards: readonly FoldedCard[] }>> };
  };
};

/** The page as this reader gets it, over the grants and the changes the server answers them. */
async function read(reader: string, grants: readonly FLGrantRow[], changes: readonly FLAddressChangeAdminOpen[] = []) {
  state.grants = [...grants];
  state.changes = [...changes];
  state.reader = reader;
  const { props } = AdministratorsPage() as unknown as Drawn;
  const { cards } = (await props.list.content).props;
  const rowsOf = (title: string) => (cards.find((card) => card.title === title)?.tables[0] as TableProps | undefined)?.rows ?? [];
  return {
    create: await props.create.act,
    side: await props.sideAct.act,
    titles: cards.map((card) => card.title),
    active: rowsOf(COPY.admin.team.active),
    waiting: rowsOf(COPY.admin.administrators.pending),
  };
}

const addresses = (rows: ReadonlyArray<{ name: unknown }>) => rows.map(({ name }) => (name as { record: string }).record);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("who holds access and what waits", () => {
  /* An addition listed among those holding access would claim a power its wait still holds back. */
  it("keeps a waiting addition out of those holding access, the owner first", async () => {
    const { active, waiting } = await read(OWNER, [grant("anna@example.org"), grant("neu@example.org", { effective_from: FUTURE }), THE_OWNER]);

    expect(addresses(active)).toStrictEqual([OWNER, "anna@example.org"]);
    expect(addresses(waiting)).toStrictEqual(["neu@example.org"]);
  });

  /* A person's change waiting on its mail, or anyone's without a grant, moves no access and has its own page. */
  it("lists a holder's change in its wait and no other", async () => {
    const changes = [change("anna@example.org", FUTURE), change("ben@example.org", null), change("pupil@example.org", FUTURE)];

    const { waiting } = await read(OWNER, [THE_OWNER, grant("anna@example.org"), grant("ben@example.org")], changes);

    expect(addresses(waiting)).toStrictEqual(["anna@example.org"]);
  });

  it("draws no „Angekündigt“ while nothing waits", async () => {
    expect((await read(OWNER, [THE_OWNER])).titles).toStrictEqual([COPY.admin.team.active]);
  });
});

describe("the owner's acts", () => {
  it("leave an administrator the list to read, what waits included", async () => {
    const handover = grant("anna@example.org", { owner_from: FUTURE });

    const { create, side, active, waiting } = await read("anna@example.org", [THE_OWNER, handover]);

    expect([create, side]).toStrictEqual([null, null]);
    expect([...active, ...waiting].filter((row) => row.acts !== undefined)).toStrictEqual([]);
    expect(addresses(waiting)).toStrictEqual(["anna@example.org"]);
  });

  /* The owner's address is folded on the grant and spelled as signed in on the session. */
  it("reach the owner whatever the session's spelling, the owner's own row left alone", async () => {
    const { create, active } = await read("Owner@Example.org", [THE_OWNER, grant("anna@example.org")]);

    expect(create).not.toBeNull();
    expect(active.map((row) => row.acts !== undefined)).toStrictEqual([false, true]);
  });

  it("offer the handover from the administrators in effect, and lock it while one waits", async () => {
    const waitingAddition = grant("neu@example.org", { effective_from: FUTURE });

    const open = await read(OWNER, [THE_OWNER, grant("anna@example.org"), waitingAddition]);
    const locked = await read(OWNER, [THE_OWNER, grant("anna@example.org", { owner_from: FUTURE })]);
    const alone = await read(OWNER, [THE_OWNER]);

    const { options } = (open.side?.children as ReactElement<{ options: ReadonlyArray<{ id: string }> }>).props;
    expect(options.map(({ id }) => id)).toStrictEqual(["anna@example.org"]);
    expect(open.side?.locked).toBeUndefined();
    expect(locked.side?.locked).toBe(COPY.admin.administrators.handoverRunning);
    expect(alone.side).toBeNull();
  });
});
