// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import BewerbungPage from "./page";

import type { FLBewerbung, FLBewerbungConfirmation, FLKontaktperson } from "@/core/generated/client/types";
import type { ReadRecord } from "@/kit/ReadPage";
import type { SeatRow } from "@/kit/SeatRows";

const ID = "65f0a0a0a0a0a0a0a0a0a0a0";

const state = vi.hoisted(() => ({ read: null as unknown }));

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/features/bewerbungen/queries", () => ({ getBewerbungById: () => Promise.resolve(state.read) }));
vi.mock("@/shared/utils/adminRead", () => ({ adminIdParamOf: () => Promise.resolve(ID) }));

const person = {
  first_name: "Anke",
  last_name: "Koerner",
  email: "a@example.de",
  phone: "069 1",
  einwilligung: { confirmed_at: null },
} as FLKontaktperson;

const open: FLBewerbungConfirmation = {
  sent_at: "2026-11-01",
  deadline: "2026-11-15",
  reminded_at: null,
  declined_at: null,
  delivery: null,
  state: "valid",
};

/** The seats of an open application whose `trainer` the submission owed no mail, as a mailbox past the bound leaves it. */
async function seatRows(): Promise<readonly SeatRow[]> {
  const bewerbung = {
    id: ID,
    version: 1,
    saison_id: "2028",
    status: "submitted",
    submitted_at: "2026-11-01",
    schule: null,
    team_id: null,
    stufengroesse: 3,
    wunschgegner: null,
    trikot: { wunschfarbe: "rot", existing_set: null },
    kader: { expected_size: 12, good_spieler: 2 },
    decision: null,
    kontakte: { trainer: person, ansprechperson: person, stellvertretung: person, trainer_is_also: null },
    confirmations: { trainer: { ...open, sent_at: null }, ansprechperson: open, stellvertretung: open },
  } as unknown as FLBewerbung;
  state.read = {
    bewerbung,
    name: "Lessing",
    seats_confirmed: 0,
    shorthand: null,
    entry: null,
    saison: { status: "future", gruppen: [], taken: [] },
  };

  const page = BewerbungPage({
    params: Promise.resolve({ saison: "2028", bewerbung: ID }),
    searchParams: Promise.resolve({}),
  } as Parameters<typeof BewerbungPage>[0]) as { props: { record: Promise<ReadRecord> } };
  const { groups } = await page.props.record;
  const seats = groups.find((group) => group.kind === "seats");
  if (seats?.kind !== "seats") throw new Error("no seats on the page");
  return seats.rows;
}

describe("a seat the submission never mailed", () => {
  /* „Link senden“ is the one way to that person, and the application goes on its day without them. */
  it("can be sent its link from the row reading „Nicht gesendet“", async () => {
    const row = (await seatRows()).find(({ id }) => id === "trainer");
    render(<>{row?.acts}</>);

    expect(row?.chips).toContainEqual({ tone: "warn", label: COPY.admin.saison.linkNotSent });
    expect(screen.getByRole("button", { name: COPY.shared.withObject(COPY.account.address.link, "send") })).toBeTruthy();
  });
});
