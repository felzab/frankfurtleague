import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import RegistrierungenPage from "./page";

import type { FLRegistrierungAdminRow } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

const state = vi.hoisted(() => ({ read: null as unknown }));

vi.mock("@/features/registrierungen/queries", () => ({ getRegistrierungenAdmin: () => Promise.resolve(state.read) }));

const row = (overrides: Partial<FLRegistrierungAdminRow>) =>
  ({
    id: "a",
    first_name: "Anke",
    last_name: "Koerner",
    team_id: "t",
    team_name: "Lessing",
    submitted_at: "2026-11-01",
    confirmed: false,
    unmailed: false,
    ...overrides,
  }) as FLRegistrierungAdminRow;

async function chips(...rows: readonly FLRegistrierungAdminRow[]): Promise<ReadonlyArray<ChipProps | undefined>> {
  state.read = { registrierungen: rows, complete: true };
  const page = RegistrierungenPage({ params: Promise.resolve({ saison: "2028" }), searchParams: Promise.resolve({}) } as Parameters<
    typeof RegistrierungenPage
  >[0]) as { props: { list: { content: Promise<{ table: { rows: ReadonlyArray<{ chip?: ChipProps }> } }> } } };
  const { table } = await page.props.list.content;
  return table.rows.map(({ chip }) => chip);
}

describe("a row's chip", () => {
  /* A pupil never mailed reads as one who has not answered, and the row lapses on its day with nobody acting on it. */
  it("parts a pupil never asked from one who has not answered", async () => {
    expect(await chips(row({ unmailed: true }), row({}))).toStrictEqual([
      { tone: "warn", label: COPY.admin.saison.linkNotSent },
      { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
    ]);
  });
});
