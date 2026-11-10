// @vitest-environment jsdom
import { CardActRow } from "@/kit/Card";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { agreeTermin, declineTermin } from "./answerTermin";
import TeamOverviewPage from "./page";

import type { FLTeamOverviewResponse, FLTeamPanelRegistrierung, FLTeamPanelTermin } from "@/core/generated/client/types";
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
  reason: null,
  ...overrides,
});

const registrierung = (overrides: Partial<FLTeamPanelRegistrierung>): FLTeamPanelRegistrierung => ({
  registrierung_id: "000000000000000000000011",
  first_name: "Ole",
  last_name: "Sommer",
  admissible: true,
  position: null,
  stufe: null,
  submitted_at: "2026-11-02",
  ...overrides,
});

/** One card's rows, as the page hands them to its template off a read holding `held` and nothing else open. */
async function rowsOf(
  card: string,
  held: Partial<Pick<FLTeamOverviewResponse, "termine" | "registrierungen">>,
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

// Handed an empty line, a row still draws the line's slot under the name: a blank gap no type and no check sees.
describe("a registration's row", () => {
  it("draws a line only where the pupil named a position or a Stufe", async () => {
    const [bare, named] = await rowsOf("registrierungen", {
      registrierungen: [registrierung({}), registrierung({ registrierung_id: "000000000000000000000012", stufe: "Q2" })],
    });
    if (bare === undefined || named === undefined) throw new Error("the card holds fewer than two rows");
    const { container } = render(
      <>
        <CardActRow {...bare} />
        <CardActRow {...named} />
      </>,
    );

    // The words under a row's name: the name's own line, then the muted line where there is one.
    const words = [...container.querySelectorAll("[data-kit-row]")].map((row) =>
      [...(row.firstElementChild?.children ?? [])].map(({ textContent }) => textContent),
    );
    expect(words).toStrictEqual([[`Ole Sommer${COPY.admin.confirmed}`], [`Ole Sommer${COPY.admin.confirmed}`, COPY.admin.saison.stufe.Q2]]);
  });
});
