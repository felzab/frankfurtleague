import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { STANDING_CHIP } from "@/features/bewerbungen/standing";

import type { FLBewerbungListRow } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** The season's applications the backend serves. */
const state = { read: null as unknown };

// The page's one read, of the season its address names, through the real guard, query and generated call.
serveBackend(({ method, path, search }) =>
  method === "GET" && path === "/bewerbungen/list/admin" && search.get("saison_id") === "2028" ? state.read : undefined,
);
// An administrator's session, made by passkey, which the read's guard admits.
signedInRequest();

const { default: BewerbungenPage } = await import("./page");

const row = (overrides: Partial<FLBewerbungListRow>) =>
  ({
    id: "a",
    name: "Lessing",
    status: "submitted",
    submitted_at: "2026-11-01",
    seats_confirmed: 2,
    duplicate: false,
    unmailed: false,
    ...overrides,
  }) as FLBewerbungListRow;

async function chips(...rows: readonly FLBewerbungListRow[]): Promise<ReadonlyArray<ChipProps | undefined>> {
  state.read = { bewerbungen: rows, complete: true, saison: { status: "future" } };
  const page = BewerbungenPage({ params: Promise.resolve({ saison: "2028" }), searchParams: Promise.resolve({}) } as Parameters<
    typeof BewerbungenPage
  >[0]) as { props: { list: { content: Promise<{ table: { rows: ReadonlyArray<{ chip?: ChipProps }> } }> } } };
  const { table } = await page.props.list.content;
  return table.rows.map(({ chip }) => chip);
}

describe("a row's chip", () => {
  /* The application goes on its day with nobody told, so the list is where an administrator catches a seat never mailed. */
  it("says a seat was never sent ahead of the standing and of a Dublette", async () => {
    const notSent = { tone: "warn", label: COPY.admin.saison.linkNotSent };

    expect(await chips(row({ unmailed: true }), row({ unmailed: true, duplicate: true }), row({}))).toStrictEqual([
      notSent,
      notSent,
      STANDING_CHIP.incomplete,
    ]);
  });
});
