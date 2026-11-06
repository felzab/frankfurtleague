// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToReadableStream } from "react-dom/server";
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

const PARAMS = {
  params: Promise.resolve({ saison: "2028", bewerbung: ID }),
  searchParams: Promise.resolve({}),
} as Parameters<typeof BewerbungPage>[0];

/** An open application whose `trainer` the submission owed no mail, as a mailbox past the bound leaves it. */
function readOf({ duplicate }: { duplicate: boolean }) {
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
  return {
    bewerbung,
    name: "Lessing",
    seats_confirmed: 0,
    duplicate,
    shorthand: null,
    entry: null,
    saison: { status: "future", gruppen: [], taken: [] },
  };
}

async function seatRows(): Promise<readonly SeatRow[]> {
  state.read = readOf({ duplicate: false });

  const page = BewerbungPage(PARAMS) as { props: { record: Promise<ReadRecord> } };
  const { groups } = await page.props.record;
  const seats = groups.find((group) => group.kind === "seats");
  if (seats?.kind !== "seats") throw new Error("no seats on the page");
  return seats.rows;
}

/** The words of the page's strip, as the server sends it once the record is read. */
async function stripOf(read: unknown): Promise<string | null | undefined> {
  state.read = read;
  const stream = await renderToReadableStream(<BewerbungPage {...PARAMS} />);
  await stream.allReady;
  const page = document.createElement("div");
  page.innerHTML = await new Response(stream).text();
  return page.querySelector("header")?.textContent;
}

describe("a Dublette on the page its decision is taken on", () => {
  /* The list's row may say „Nicht gesendet“ instead, so this is the one place an administrator is sure to read it. */
  it("stands beside the standing chip, which stays", async () => {
    expect(await stripOf(readOf({ duplicate: true }))).toBe(`Lessing${COPY.admin.bewerbung.incomplete}${COPY.admin.bewerbung.teamDouble}`);
    expect(await stripOf(readOf({ duplicate: false }))).toBe(`Lessing${COPY.admin.bewerbung.incomplete}`);
  });
});

describe("a seat the submission never mailed", () => {
  /* „Link senden“ is the one way to that person, and the application goes on its day without them. */
  it("can be sent its link from the row reading „Nicht gesendet“", async () => {
    const row = (await seatRows()).find(({ id }) => id === "trainer");
    render(<>{row?.acts}</>);

    expect(row?.chips).toContainEqual({ tone: "warn", label: COPY.admin.saison.linkNotSent });
    expect(screen.getByRole("button", { name: COPY.shared.withObject(COPY.account.address.link, "send") })).toBeTruthy();
  });
});
