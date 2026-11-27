// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, describe, expect, it, vi } from "vitest";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { renderUnderNext } from "@/test-support/nextContexts";
import { signedInRequest } from "@/test-support/session";
import { seat } from "@/test-support/subjectFixtures";

import type {
  FLAufstellungPhase,
  FLTeamOverviewResponse,
  FLTeamPanelAufstellung,
  FLTeamPanelSpielbestaetigung,
} from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { ReactElement } from "react";

const TEAM = "6af32ed4205642a3fd5ee7e1";

/** The team's overview as the backend holds it, which each case sets. */
const stored = { read: undefined as FLTeamOverviewResponse | undefined };

// The league's calendar day the deadlines and the decline's proposal are judged by, set before the session is made so
// its stamps share the clock.
vi.setSystemTime(new Date("2026-11-10T12:00:00+01:00"));

// The page's one read, the overview of the team and the season the address names, and a row's answer, whose path
// names its confirmation row. Any other request, another club's or another season's read among them, fails the case.
const ANSWERED = /^\/spielbestaetigungen\/[0-9a-f]{24}\/answer\/team$/u;
const backend = serveBackend(({ method, path }) => {
  if (method === "GET" && path === `/teams/${TEAM}/saisons/2027/overview`) return stored.read;
  return method === "POST" && ANSWERED.test(path) ? new Response(null, { status: 204 }) : undefined;
});
// A contact seated on the team in its running season, signed in by a typed code.
signedInRequest({ email: "pia@example.org", records: { seats: [seat({ team_id: TEAM, saison_id: "2027", saison_status: "active" })] } });
const { default: TeamOverviewPage } = await import("./page");

afterAll(() => {
  vi.useRealTimers();
});

const spielbestaetigung = (overrides: Partial<FLTeamPanelSpielbestaetigung>): FLTeamPanelSpielbestaetigung => ({
  spielbestaetigung_id: "000000000000000000000001",
  spiel_id: "0000000000000000000000a1",
  ansetzung: { date: "2026-11-14", time: "16:00:00", spielort: null, team1_name: "Ahorn", team2_name: "Eiche" },
  side: "team1",
  state: "valid",
  deadline: "2026-11-12",
  lapsed_on: null,
  vorschlag: null,
  ...overrides,
});

/** One card's rows, as the page hands them to its template off a read holding `held` and nothing else open. */
async function rowsOf(
  card: string,
  held: Partial<Pick<FLTeamOverviewResponse, "spielbestaetigungen" | "aufstellungen" | "registrierungen">>,
): Promise<ReadonlyArray<CardActRowProps & { id: string }>> {
  stored.read = {
    shorthand: "AHO",
    full_name: "Ahorn-Gymnasium",
    spielbestaetigungen: [],
    aufstellungen: [],
    registrierungen: [],
    seats: [],
    ...held,
  } satisfies FLTeamOverviewResponse;
  const page = TeamOverviewPage({ params: Promise.resolve({ team: TEAM, saison: "2027" }) } as Parameters<typeof TeamOverviewPage>[0]) as {
    props: { list: { content: Promise<{ cards: ReadonlyArray<{ id: string; rows: ReadonlyArray<CardActRowProps & { id: string }> }> }> } };
  };
  const { cards } = await page.props.list.content;
  return cards.find(({ id }) => id === card)?.rows ?? [];
}

/** The Termine card's rows. */
const spielbestaetigungen = (...rows: readonly FLTeamPanelSpielbestaetigung[]) =>
  rowsOf("spielbestaetigungen", { spielbestaetigungen: [...rows] });

// Every id on the page is a 24-digit hex string, the fixture's beside its confirmation row's: an answer posted with
// the fixture's id, or with another row's, is refused or lands on another date, and no type tells them apart.
describe("a date's answer", () => {
  const first = spielbestaetigung({});
  const second = spielbestaetigung({
    spielbestaetigung_id: "000000000000000000000002",
    spiel_id: "0000000000000000000000a2",
    ansetzung: { date: "2026-11-21", time: "16:00:00", spielort: null, team1_name: "Ahorn", team2_name: "Linde" },
  });

  /** Each answer the backend took, by the confirmation row its path names and what it answered. */
  const answers = () =>
    backend.sent.filter(({ method }) => method === "POST").map(({ path, body }) => ({ path, answer: (body as { answer: string }).answer }));
  const answerPath = `/spielbestaetigungen/${second.spielbestaetigung_id}/answer/team`;

  it("agrees to the row pressed, by its confirmation row", async () => {
    const rows = await spielbestaetigungen(first, second);
    renderUnderNext(rows[1]?.acts as ReactElement);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.agree }));

    await waitFor(() => expect(answers()).toStrictEqual([{ path: answerPath, answer: "agreed" }]));
  });

  it("declines the row pressed, by its confirmation row", async () => {
    const rows = await spielbestaetigungen(first, second);
    renderUnderNext(rows[1]?.acts as ReactElement);

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.decline }));
    const dialog = await screen.findByRole("dialog");
    // Day, month and year, then hour and minute: each field's segments in turn, the year's taking any digits after it.
    const [day, , , hour] = within(dialog).getAllByRole("spinbutton");
    await userEvent.click(day as HTMLElement);
    await userEvent.keyboard("25112026");
    await userEvent.click(hour as HTMLElement);
    await userEvent.keyboard("1800");
    await userEvent.click(within(dialog).getByRole("button", { name: COPY.shared.verb.decline }));

    await waitFor(() => expect(answers()).toStrictEqual([{ path: answerPath, answer: "declined" }]));
  });
});

// The backend refuses every answer to these, so a button on them would end on a refusal the person cannot repair.
describe("a date the team cannot answer", () => {
  it("carries no act past its deadline, declined or agreed", async () => {
    const rows = await spielbestaetigungen(
      spielbestaetigung({ state: "expired" }),
      spielbestaetigung({ state: "declined" }),
      spielbestaetigung({ state: "agreed" }),
    );

    expect(rows.map(({ acts }) => acts)).toStrictEqual([undefined, undefined, undefined]);
  });
});

// The harm: a date an exit ended before its deadline read as lapsed on a day still to come, which the team cannot have
// missed.
describe("a lapsed date", () => {
  it("names the day it lapsed on, and none where it ended on no day", async () => {
    const rows = await spielbestaetigungen(
      spielbestaetigung({ state: "expired", deadline: "2026-11-08", lapsed_on: "2026-11-08" }),
      spielbestaetigung({ state: "expired", spielbestaetigung_id: "000000000000000000000002" }),
    );

    const when = COPY.spielplan.when("2026-11-14", "16:00:00");
    expect(rows.map(({ line }) => line)).toStrictEqual([
      COPY.shared.line([when, COPY.shared.expiredOn("2026-11-08"), AREA_COPY.team.leagueDecides]),
      COPY.shared.line([when, AREA_COPY.team.leagueDecides]),
    ]);
  });
});

// A row past its due mark that says so only in its muted line reads as one still in time.
describe("a line-up's row", () => {
  it("carries „Überfällig“ from its due mark and „Gesperrt“ from the lock", async () => {
    const aufstellung = (phase: FLAufstellungPhase): FLTeamPanelAufstellung => ({
      spiel_id: "0000000000000000000000a1",
      ansetzung: { date: "2026-11-14", time: "16:00:00", spielort: null, team1_name: "Ahorn", team2_name: "Eiche" },
      marks: { due_at: "2026-11-13T15:00:00Z", phase, stored: false },
    });
    const rows = await rowsOf("aufstellungen", { aufstellungen: [aufstellung("open"), aufstellung("overdue"), aufstellung("locked")] });

    const overdue = { tone: "danger", label: COPY.aufstellung.overdue };
    expect(rows.map(({ chip }) => chip)).toStrictEqual([undefined, overdue, { tone: "neutral", label: COPY.aufstellung.locked }]);
  });
});
