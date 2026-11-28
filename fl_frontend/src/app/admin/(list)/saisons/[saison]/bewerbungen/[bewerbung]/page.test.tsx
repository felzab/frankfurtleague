// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { renderUnderNext, underNext } from "@/test-support/nextContexts";
import { drawnOnServer } from "@/test-support/server";
import { signedInRequest } from "@/test-support/session";

import type { FLBewerbung, FLBewerbungConfirmation, FLKontaktpersonAdmin } from "@/core/generated/client/types";
import type { ReadRecord } from "@/kit/ReadPage";
import type { SeatRow } from "@/kit/SeatRows";

const ID = "65f0a0a0a0a0a0a0a0a0a0a0";

/** The application the backend serves at the address's id. */
const state = { read: null as unknown };

// The page's one read, of the application its address names, through the real guard, query and generated call.
serveBackend(({ method, path }) => (method === "GET" && path === `/bewerbungen/${ID}` ? state.read : undefined));
// An administrator's session, made by passkey, which the page's guard admits.
signedInRequest();

const { default: BewerbungPage } = await import("./page");

const person = {
  first_name: "Anke",
  last_name: "Koerner",
  email: "a@example.net",
  phone: "069 1",
  einwilligung: { confirmed_at: null },
} as FLKontaktpersonAdmin;

const open: FLBewerbungConfirmation = {
  sent_at: "2026-11-01",
  deadline: "2026-11-15",
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

async function seatRows(read: unknown = readOf({ duplicate: false })): Promise<readonly SeatRow[]> {
  state.read = read;

  const page = BewerbungPage(PARAMS) as { props: { record: Promise<ReadRecord> } };
  const { groups } = await page.props.record;
  const seats = groups.find((group) => group.kind === "seats");
  if (seats?.kind !== "seats") throw new Error("no seats on the page");
  return seats.rows;
}

/** The words of the page's strip, as the server sends it once the record is read. */
async function stripOf(read: unknown): Promise<string | null | undefined> {
  state.read = read;
  const page = await drawnOnServer(underNext(<BewerbungPage {...PARAMS} />));
  return page.querySelector("header")?.textContent;
}

describe("a Dublette on the page its decision is taken on", () => {
  /* The list's row may say „Nicht gesendet“ instead, so this is the one place an administrator is sure to read it. */
  it("stands beside the standing chip, which stays", async () => {
    expect(await stripOf(readOf({ duplicate: true }))).toBe(`Lessing${ADMIN_COPY.bewerbung.incomplete}${ADMIN_COPY.bewerbung.teamDouble}`);
    expect(await stripOf(readOf({ duplicate: false }))).toBe(`Lessing${ADMIN_COPY.bewerbung.incomplete}`);
  });
});

describe("an accepted application", () => {
  /* Its acceptance emptied the seats, its people now its team's: rows reading „Niemand“ would tell the administrator the
     school lost its contacts. */
  it("shows no seats, its decision and its way to the team standing", async () => {
    const read = readOf({ duplicate: false });
    const empty = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_is_also: null };
    state.read = {
      ...read,
      bewerbung: { ...read.bewerbung, status: "accepted", team_id: ID, decision: { made_at: "2026-11-20", reason: null }, kontakte: empty },
      seats_confirmed: 3,
      entry: { gruppe: "A", trikot_farbe: null },
    };

    const page = BewerbungPage(PARAMS) as { props: { record: Promise<ReadRecord> } };
    const { groups, acts } = await page.props.record;

    expect(groups.map(({ kind }) => kind)).toStrictEqual(["facts"]);
    expect(acts).toHaveLength(1);
  });
});

describe("an undecided application of a finished season", () => {
  /* The backend refuses its seats' writes and fresh links, so an act offered here would fail only once pressed. */
  it("offers no seat its edit or its link", async () => {
    const read = readOf({ duplicate: false });

    const rows = await seatRows({ ...read, saison: { ...read.saison, status: "past" } });

    expect(rows.map(({ acts }) => acts)).toStrictEqual([undefined, undefined, undefined]);
  });
});

describe("a seat the submission never mailed", () => {
  /* „Link senden“ is the one way to that person, and the application goes on its day without them. */
  it("can be sent its link from the row reading „Nicht gesendet“", async () => {
    // A rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
    const row = (await seatRows()).find(({ id }) => id === "trainer");
    renderUnderNext(<>{row?.acts}</>);

    expect(row?.chips).toContainEqual({ tone: "warn", label: COPY.shared.state.linkNotSent });
    // A seat's acts stand in its row's „⋯“.
    await userEvent.click(screen.getByRole("button", { name: COPY.template.more }));
    expect(screen.getByRole("menuitem", { name: COPY.shared.withObject(COPY.shared.link, "send") })).toBeTruthy();
  });
});
