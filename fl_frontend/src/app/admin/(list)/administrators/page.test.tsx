import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { assert, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import type { FLAddressChangeAdminOpen, FLGrantRow } from "@/core/generated/client/types";
import type { ListCreate } from "@/kit/ListPage";
import type { FoldedCard } from "@/kit/ReadFolds";
import type { TableProps } from "@/kit/Table";
import type { ReactElement } from "react";

const OWNER = "owner@example.org";
const PAST = "2026-01-01T10:00:00Z";
const FUTURE = "2999-01-01T10:00:00Z";

/** The grants and the running changes the backend serves. */
const state = { grants: [] as unknown[], changes: [] as unknown[] };

// The page's two reads, through the real guard, queries and generated calls.
serveBackend(({ method, path }) => {
  if (method !== "GET") return undefined;
  if (path === "/grants") return { grants: state.grants };
  if (path === "/address_change") return { changes: state.changes };
  return undefined;
});
// The owner's session, made by passkey, which the reads' guard admits and the page reads its reader off; a case reading
// as another administrator arrives as them.
const { arriveAs, store } = signedInRequest({ email: OWNER, admin: true });

// Server functions, which the page hands its dialogs and a client reaches over the network: no case presses one.
vi.mock("@/features/grants/actions", () => ({
  addAdministrator: () => undefined,
  removeAdministrator: () => undefined,
  startHandover: () => undefined,
  stopHandover: () => undefined,
}));
vi.mock("@/features/address-change/actions", () => ({ discardChange: () => undefined }));

const { default: AdministratorsPage } = await import("./page");

const grant = (address: string, overrides: Partial<FLGrantRow> = {}) =>
  ({
    id: address,
    address,
    admin_tier: "administration",
    effective_from: PAST,
    owner_from: null,
    ...overrides,
  }) as FLGrantRow;

const THE_OWNER = grant(OWNER, { admin_tier: "owner" });

const change = (address: string, effective_from: string | null, holder: FLAddressChangeAdminOpen["holder"] = "administration") =>
  ({ id: `change-${address}`, address, email: "neu@example.org", effective_from, holder }) as FLAddressChangeAdminOpen;

type Drawn = {
  props: {
    side: Promise<ListCreate>;
    create: Promise<ListCreate>;
    list: { content: Promise<ReactElement<{ cards: readonly FoldedCard[] }>> };
  };
};

/** The page as the session signed in gets it, over the grants and the changes the server answers it. */
async function read(grants: readonly FLGrantRow[], changes: readonly FLAddressChangeAdminOpen[] = []) {
  state.grants = [...grants];
  state.changes = [...changes];
  const { props } = AdministratorsPage() as unknown as Drawn;
  const { cards } = (await props.list.content).props;
  const tableOf = (title: string) => cards.find((card) => card.title === title)?.tables[0] as TableProps | undefined;
  return {
    side: await props.side,
    create: await props.create,
    cards: cards.map(({ title, count }) => ({ title, count })),
    active: tableOf(COPY.admin.team.active)?.rows ?? [],
    waiting: tableOf(COPY.admin.administrators.pending)?.rows ?? [],
    waitingEmpty: tableOf(COPY.admin.administrators.pending)?.empty,
  };
}

const addresses = (rows: ReadonlyArray<{ name: unknown }>) => rows.map(({ name }) => (name as { record: string }).record);

/** Each row's one act as the reader gets it: its reason where it is locked, `"runs"` where a press runs it. */
const actsOf = (rows: ReadonlyArray<{ acts?: unknown }>) =>
  rows.map(({ acts }) => (acts as ReactElement<{ locked?: string }> | undefined)?.props.locked ?? (acts === undefined ? "none" : "runs"));

describe("who holds access and what waits", () => {
  /* An addition listed among those holding access would claim a power its wait still holds back. */
  it("keeps a waiting addition out of those holding access, the owner first", async () => {
    const { active, waiting } = await read([grant("anna@example.org"), grant("neu@example.org", { effective_from: FUTURE }), THE_OWNER]);

    expect(addresses(active)).toStrictEqual([OWNER, "anna@example.org"]);
    expect(addresses(waiting)).toStrictEqual(["neu@example.org"]);
  });

  /* A person's change waiting on its mail, or anyone's without a grant, moves no access and has its own page. */
  it("lists a holder's change in its wait and no other", async () => {
    const changes = [change("anna@example.org", FUTURE), change("ben@example.org", null), change("pupil@example.org", FUTURE, null)];

    const { waiting } = await read([THE_OWNER, grant("anna@example.org"), grant("ben@example.org")], changes);

    expect(addresses(waiting)).toStrictEqual(["anna@example.org"]);
  });

  /* A card drawn only while something waits moves the page under its reader whenever nothing does. */
  it("draws „Angekündigt“ while nothing waits, saying so", async () => {
    const { cards, waitingEmpty } = await read([THE_OWNER, grant("anna@example.org")]);

    expect(cards).toStrictEqual([
      { title: COPY.admin.team.active, count: 2 },
      { title: COPY.admin.administrators.pending, count: 0 },
    ]);
    expect(waitingEmpty).toStrictEqual({ kind: "clear" });
  });
});

describe("the owner's acts", () => {
  /* An act left off tells an administrator nothing of who may run it, nor the owner why their own row holds none. */
  it("show an administrator every act, on the toolbar and on every row, locked as the owner's alone", async () => {
    const handover = grant("anna@example.org", { owner_from: FUTURE });

    await arriveAs({ email: "anna@example.org", admin: true });
    const { create, side, active, waiting } = await read([THE_OWNER, handover]);

    const ownerOnly = COPY.admin.administrators.ownerOnly;
    expect([create.locked, side.locked]).toStrictEqual([ownerOnly, ownerOnly]);
    expect(actsOf([...active, ...waiting])).toStrictEqual([ownerOnly, ownerOnly, ownerOnly]);
    expect(addresses(waiting)).toStrictEqual(["anna@example.org"]);
  });

  /* The owner's address is folded on the grant and spelled as signed in on the session. */
  it("reach the owner whatever the session's spelling, the owner's own row locked until the handover", async () => {
    // The library folds an address it signs in, so a spelling of the owner's own is one its store holds for them.
    const account = store.user.find(({ email }) => email === OWNER);
    assert(account !== undefined, "the owner's sign-in stored no account");
    account.email = "Owner@Example.org";

    const { create, active } = await read([THE_OWNER, grant("anna@example.org")]);

    expect(create.locked).toBeUndefined();
    expect(actsOf(active)).toStrictEqual([COPY.admin.administrators.afterHandover, "runs"]);
  });

  it("offer the handover from the administrators in effect, locked while one waits or none stands to take over", async () => {
    const waitingAddition = grant("neu@example.org", { effective_from: FUTURE });

    const open = await read([THE_OWNER, grant("anna@example.org"), waitingAddition]);
    const locked = await read([THE_OWNER, grant("anna@example.org", { owner_from: FUTURE })]);
    const alone = await read([THE_OWNER, waitingAddition]);

    const { options } = (open.side.children as ReactElement<{ options: ReadonlyArray<{ id: string }> }>).props;
    expect(options.map(({ id }) => id)).toStrictEqual(["anna@example.org"]);
    expect(open.side.locked).toBeUndefined();
    expect(locked.side.locked).toBe(COPY.admin.administrators.handoverRunning);
    expect(alone.side.locked).toBe(COPY.admin.administrators.noAdministrator);
  });
});
