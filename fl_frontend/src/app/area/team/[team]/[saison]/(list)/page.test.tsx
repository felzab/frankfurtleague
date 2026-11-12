// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { agreeTermin, declineTermin } from "./answerTermin";
import TeamOverviewPage from "./page";

import type { FLAufstellungPhase, FLTeamOverviewResponse, FLTeamPanelAufstellung, FLTeamPanelTermin } from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({ read: null as unknown }));

const DONE = { ok: true, value: undefined } as const;

vi.mock("./answerTermin", () => ({ agreeTermin: vi.fn(), declineTermin: vi.fn() }));
vi.mock("@/features/teams/queries", () => ({ getTeamOverview: () => Promise.resolve(state.read) }));
vi.mock("@/features/roles/resolvers", () => ({
  requireTeamSeats: () => Promise.resolve([{ team_id: "6af32ed4205642a3fd5ee7e1", saison_id: "2027" }]),
  readAsSeatHolder: <Read,>(read: () => Promise<Read>) => read(),
}));
vi.mock("@/core/clock", () => ({ now: () => new Date("2026-11-10T12:00:00+01:00") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

afterEach(() => {
  vi.clearAllMocks();
});

const termin = (overrides: Partial<FLTeamPanelTermin>): FLTeamPanelTermin => ({
  spielbestaetigung_id: "000000000000000000000001",
  spiel_id: "0000000000000000000000a1",
  ansetzung: { date: "2026-11-14", time: "16:00:00", spielort: null, team1_name: "Ahorn", team2_name: "Eiche" },
  side: "team1",
  state: "valid",
  deadline: "2026-11-12",
  vorschlag: null,
  ...overrides,
});

/** One card's rows, as the page hands them to its template off a read holding `held` and nothing else open. */
async function rowsOf(
  card: string,
  held: Partial<Pick<FLTeamOverviewResponse, "termine" | "aufstellungen" | "registrierungen">>,
): Promise<ReadonlyArray<CardActRowProps & { id: string }>> {
  state.read = {
    team_id: "6af32ed4205642a3fd5ee7e1",
    saison_id: "2027",
    name: "Ahorn",
    shorthand: "AHO",
    full_name: "Ahorn-Gymnasium",
    trikot_farbe: null,
    rollen: ["ansprechperson"],
    termine: [],
    aufstellungen: [],
    registrierungen: [],
    registrierungen_complete: true,
    seats: [],
    ...held,
  } satisfies FLTeamOverviewResponse;
  const page = TeamOverviewPage({ params: Promise.resolve({ team: "6af32ed4205642a3fd5ee7e1", saison: "2027" }) } as Parameters<
    typeof TeamOverviewPage
  >[0]) as {
    props: { list: { content: Promise<{ cards: ReadonlyArray<{ id: string; rows: ReadonlyArray<CardActRowProps & { id: string }> }> }> } };
  };
  const { cards } = await page.props.list.content;
  return cards.find(({ id }) => id === card)?.rows ?? [];
}

/** The Termine card's rows. */
const termine = (...rows: readonly FLTeamPanelTermin[]) => rowsOf("termine", { termine: [...rows] });

// Every id on the page is a 24-digit hex string, the fixture's beside its confirmation row's: an answer posted with
// the fixture's id, or with another row's, is refused or lands on another date, and no type tells them apart.
describe("a date's answer", () => {
  const first = termin({});
  const second = termin({
    spielbestaetigung_id: "000000000000000000000002",
    spiel_id: "0000000000000000000000a2",
    ansetzung: { date: "2026-11-21", time: "16:00:00", spielort: null, team1_name: "Ahorn", team2_name: "Linde" },
  });

  it("agrees to the row pressed, by its confirmation row", async () => {
    vi.mocked(agreeTermin).mockResolvedValue(DONE);
    const rows = await termine(first, second);
    render(rows[1]?.acts as ReactElement);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.agree }));

    expect(agreeTermin).toHaveBeenCalledExactlyOnceWith({ id: second.spielbestaetigung_id });
  });

  it("declines the row pressed, by its confirmation row", async () => {
    vi.mocked(declineTermin).mockResolvedValue(DONE);
    const rows = await termine(first, second);
    render(rows[1]?.acts as ReactElement);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.decline }));
    const dialog = await screen.findByRole("dialog");
    // Day, month and year, then hour and minute: each field's segments in turn, the year's taking any digits after it.
    const [day, , , hour] = within(dialog).getAllByRole("spinbutton");
    await userEvent.click(day as HTMLElement);
    await userEvent.keyboard("25112026");
    await userEvent.click(hour as HTMLElement);
    await userEvent.keyboard("1800");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.shared.verb.decline }));

    await waitFor(() => expect(declineTermin).toHaveBeenCalledOnce());
    const posted = vi.mocked(declineTermin).mock.calls[0]?.[0] as FormData;
    expect(posted.get("id")).toBe(second.spielbestaetigung_id);
  });
});

// The backend refuses every answer to these, so a button on them would end on a refusal the person cannot repair.
describe("a date the team cannot answer", () => {
  it("carries no act past its deadline, declined or agreed", async () => {
    const rows = await termine(termin({ state: "expired" }), termin({ state: "declined" }), termin({ state: "agreed" }));

    expect(rows.map(({ acts }) => acts)).toStrictEqual([undefined, undefined, undefined]);
  });
});

// A row past its due mark that says so only in its muted line reads as one still in time, beside an overdue date's chip.
describe("a line-up's row", () => {
  it("carries „Überfällig“ from its due mark, as an overdue date does, and „Gesperrt“ from the lock", async () => {
    const aufstellung = (phase: FLAufstellungPhase): FLTeamPanelAufstellung => ({
      spiel_id: "0000000000000000000000a1",
      ansetzung: { date: "2026-11-14", time: "16:00:00", spielort: null, team1_name: "Ahorn", team2_name: "Eiche" },
      side: "team1",
      marks: { due_at: "2026-11-13T15:00:00Z", phase, stored: false },
    });
    const rows = await rowsOf("aufstellungen", { aufstellungen: [aufstellung("open"), aufstellung("overdue"), aufstellung("locked")] });
    const [overdueDate] = await termine(termin({ state: "expired" }));

    const overdue = { tone: "danger", label: COPY.area.team.aufstellung.overdue };
    expect(overdueDate?.chip).toStrictEqual(overdue);
    expect(rows.map(({ chip }) => chip)).toStrictEqual([undefined, overdue, { tone: "neutral", label: COPY.area.team.aufstellung.locked }]);
  });
});
