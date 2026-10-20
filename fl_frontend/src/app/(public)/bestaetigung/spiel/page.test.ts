import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { act, createRef, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleLogger, doubleToasts, loggedErrorCodes } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import {
  answerReadsWith,
  backendUnreachable,
  callPage,
  clearSteps,
  EMPTIEST_ANSWER,
  pageBody,
  readsOf,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { SpielbestaetigungStart } from "@/features/spielbestaetigungen/components/views/SpielbestaetigungView.tsx";
import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();
// The browser's own `fetch`, through which the open page's press reaches its route handler.
const fetchMock = doubleFetch();
doubleLogger();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: SpielbestaetigungPage, metadata } = await import("./page.tsx");
const { AdresseGesperrt } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

const VIEW_ENDPOINT = "/spielbestaetigungen/ansicht";
const TOKEN = "kein-echtes-token";

/** The view as the backend serves it, every field filled whatever the state: the page is what narrows it. */
const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig",
  seite: "team1",
  ansetzung: {
    team1_name: "FC Alpha",
    team2_name: "Lessing-Kolleg",
    datum: "2026-11-07",
    uhrzeit: "14:30:00",
    spielort: { spielort_id: "6890a1b2c3d4e5f607250001", name: "Sportpark Nord", maps_link: "https://maps.example.org" },
  },
  frist: "2026-10-31",
  vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" },
  beantwortet_von: { art: "kontakt", rolle: "trainer" },
};

const PROPS: NextPageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({ token: TOKEN }) };

/** Answers the link's read with `view`, every other read with its emptiest answer. */
function viewAnswers(view: () => unknown): void {
  answerReadsWith((endpoint, schema, params) => (endpoint === VIEW_ENDPOINT ? view() : EMPTIEST_ANSWER(endpoint, schema, params)));
}

/** What the page hands its view, for the read `view` answers. */
async function startFor(view: () => unknown, props = PROPS): Promise<SpielbestaetigungStart> {
  viewAnswers(view);
  const body = (await pageBody(SpielbestaetigungPage, props)) as ReactElement<{ start: SpielbestaetigungStart }>;
  return body.props.start;
}

beforeEach(() => {
  clearSteps();
});

describe("what the fixture confirmation page reads", () => {
  /* Behind `connection()`, so no prerender ever reads a link, and the token in the body rather than the query string. */
  it("reads the link's view once per request, carrying the token in the body", async () => {
    viewAnswers(() => ANSICHT);

    const walk = await callPage(SpielbestaetigungPage, PROPS);

    assert.deepEqual(walk.thrown, []);
    assert.deepEqual(walk.unconnected, [], "the page reads before the request is known");
    assert.deepEqual(
      readsOf(steps).map(({ endpoint }) => endpoint),
      [VIEW_ENDPOINT],
    );
    assert.deepEqual(steps.find((step) => step.kind === "read")?.body, { token: TOKEN });
  });

  it("reads nothing for an address carrying no token, and opens the dead link", async () => {
    const start = await startFor(() => ANSICHT, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });

    assert.deepEqual(start, { zustand: "ungueltig" });
    assert.deepEqual(readsOf(steps), []);
  });

  it("hands an open link the whole view and the token a press spends", async () => {
    assert.deepEqual(await startFor(() => ANSICHT), { zustand: "gueltig", ansicht: ANSICHT, token: TOKEN });
  });
});

/* The request's heading and button name the act „Spieltermin bestätigen“, so the tab and the heading the button
   opens on name it alike, as the other link flows name theirs (`fl_frontend/src/core/spielEmail.test.ts`). */
describe("what the fixture confirmation page is titled", () => {
  it("names the tab and an open link's heading „Spieltermin bestätigen“", async () => {
    viewAnswers(() => ANSICHT);
    render(await pageBody(SpielbestaetigungPage, PROPS));

    assert.equal(metadata.title, "Spieltermin bestätigen");
    assert.ok(screen.getByRole("heading", { level: 1, name: "Spieltermin bestätigen" }));
  });
});

describe("what a spent link's page carries", () => {
  // The fixture's own day on Berlin's calendar, so a lapsed link to it is no link to a match already due yet.
  beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.parse(`${ANSICHT.ansetzung.datum}T10:00:00Z`) }));
  afterEach(() => mock.timers.reset());

  /* A dead link may have been forwarded: its page carries nothing of the fixture, and no token. */
  for (const zustand of ["abgelaufen", "ungueltig", "gesperrt"] as const) {
    it(`hands the ${zustand} state alone to the view`, async () => {
      assert.deepEqual(await startFor(() => ({ ...ANSICHT, zustand })), { zustand });
    });
  }

  /* The view serves no close reason, so the fixture's day decides, Berlin's and not the server's: half past midnight
     there is still the fixture's day in UTC. */
  it("opens a lapsed link whose fixture's day went by on the panel saying so", async () => {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse(`${ANSICHT.ansetzung.datum}T23:30:00Z`) });

    assert.deepEqual(await startFor(() => ({ ...ANSICHT, zustand: "abgelaufen" })), { zustand: "termin-vorbei" });
    // Only a lapsed link: a void one was moved off or replaced, so the day it asked about decides nothing.
    assert.deepEqual(await startFor(() => ({ ...ANSICHT, zustand: "ungueltig" })), { zustand: "ungueltig" });
  });

  /* The seat is a role and never a person, and it is what tells the club's other two seats who answered. */
  for (const zustand of ["zugesagt", "abgelehnt"] as const) {
    it(`hands the ${zustand} state the seat that answered and nothing else`, async () => {
      assert.deepEqual(await startFor(() => ({ ...ANSICHT, zustand })), { zustand, beantwortet_von: ANSICHT.beantwortet_von });
    });
  }

  it("opens a token the backend matches to no row on the dead link", async () => {
    const start = await startFor(() => {
      throw refusedOn("POST /spielbestaetigungen/ansicht", "REQ-ANSETZUNG-001");
    });

    assert.deepEqual(start, { zustand: "ungueltig" });
  });

  /* The dead-link panel here would call a live link void on a day the backend was merely unreachable. */
  it("opens a link whose read the network never answered on the failed read's panel, logging nothing", async () => {
    const start = await startFor(() => {
      throw backendUnreachable(VIEW_ENDPOINT, "POST");
    });

    assert.deepEqual(start, { zustand: "unlesbar" });
    assert.deepEqual(loggedErrorCodes(), [], "a read the network never answered was logged as a fault");
  });

  /* A bug in the read's narrowing opens the same panel as a read that failed, so only its line tells them apart. */
  it("logs a read that threw untyped, and opens the failed read's panel", async () => {
    const start = await startFor(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'zustand')");
    });

    assert.deepEqual(start, { zustand: "unlesbar" });
    assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"], "the failure went unlogged");
  });

  /* An answered view naming nobody who answered is a broken contract, which the error boundary logs. */
  it("lets an answered view naming no seat reach the error boundary", async () => {
    await assert.rejects(
      startFor(() => ({ ...ANSICHT, zustand: "zugesagt", beantwortet_von: null })),
      { name: "ContractBreakError" },
      "the page absorbed an answered view it cannot word",
    );
  });
});

describe("what a link to a barred address opens on", () => {
  it("is the shared barred page and nothing beside it", async () => {
    viewAnswers(() => ({ ...ANSICHT, zustand: "gesperrt" }));
    const body = await pageBody(SpielbestaetigungPage, PROPS);

    assert.equal(
      renderTree(body),
      renderTree(h(AdresseGesperrt, { panelRef: createRef<HTMLElement>() })),
      "the page draws its own barred page, or something beside the shared one",
    );
  });

  /* A ban entered while the form stood open: the refused press swaps the form for the same page rather
     than raising the sentence as a toast over the form. */
  it("swaps an open form for that page when the press is refused on the ban", async () => {
    toasts.length = 0;
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: false, zustand: "gesperrt" }))));
    viewAnswers(() => ANSICHT);
    const { unmount } = render(await pageBody(SpielbestaetigungPage, PROPS));

    await userEvent.setup().click(screen.getByRole("button", { name: /Zusagen/ }));
    await act(fetchMock.answered);

    const shown = await screen.findByText(LINK_ADRESSE_GESPERRT);
    const buttons = screen.queryAllByRole("button").length;
    unmount();

    assert.ok(shown, "the page kept the form the press cannot use again");
    assert.equal(buttons, 0, "a press stands beside the barred sentence");
    assert.deepEqual(toasts, [], "the ban was raised as a toast over the form");
  });
});

describe("the address the fixture confirmation page opened under", () => {
  it("loses the link's token once the page is open", async () => {
    window.history.replaceState(null, "", `/bestaetigung/spiel?token=${TOKEN}`);
    viewAnswers(() => ANSICHT);
    const { unmount } = render(await pageBody(SpielbestaetigungPage, PROPS));
    const adresse = `${window.location.pathname}${window.location.search}`;
    unmount();

    assert.equal(adresse, "/bestaetigung/spiel", "the page leaves its token in the address bar");
  });

  it("keeps the token where the link could not be read, so a reload can retry it", async () => {
    window.history.replaceState(null, "", `/bestaetigung/spiel?token=${TOKEN}`);
    viewAnswers(() => {
      throw backendUnreachable(VIEW_ENDPOINT, "POST");
    });
    const { unmount } = render(await pageBody(SpielbestaetigungPage, PROPS));
    const adresse = `${window.location.pathname}${window.location.search}`;
    unmount();

    assert.equal(adresse, `/bestaetigung/spiel?token=${TOKEN}`, "the page stripped the token a reload needs");
  });
});
