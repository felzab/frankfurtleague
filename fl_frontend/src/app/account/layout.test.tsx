// @vitest-environment jsdom
import { Suspense } from "react";

import { serveBackend } from "@/test-support/backend";
import { underNext } from "@/test-support/nextContexts";
import { signedInRequest } from "@/test-support/session";
import { seat } from "@/test-support/subjectFixtures";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

// No answer of its own: the frame reads nothing beyond the session's lookup, so any other request fails the case.
serveBackend();
// A person holding one contact seat, signed in by a typed code.
signedInRequest({ email: "pia@example.org", records: { seats: [seat()] } });
const { default: AccountListLayout } = await import("./(list)/layout");
const { default: AccountLayout } = await import("./layout");

/**
 * Konto's frame around the list of its pages, for the person signed in. The layouts are server components the server
 * renders once, so each is called once here and its reads begin once: drawn as components by the browser's React, each
 * retry would begin them anew, and a read answered over the network would never settle before the next retry. The
 * render stands in a boundary of its own, where a suspended read can settle before the retry.
 */
async function renderFor() {
  const frame = AccountLayout({ children: AccountListLayout({ children: <p>Seite</p> }) });
  await act(async () => render(underNext(<Suspense>{frame}</Suspense>, { pathname: ROUTES.account.path(), params: {} })));
  // The frame holds no boundary of its own, so its page shows once every read it waits on is answered.
  await screen.findByText("Seite");
}

/** Where each „‹ Zurück“ leads and each logo, the rail's head's and the phone's band's. */
const backs = () => screen.queryAllByRole("link", { name: COPY.shared.back }).map((link) => link.getAttribute("href"));
const logos = () => screen.queryAllByRole("link", { name: COPY.brand.name }).map((link) => link.getAttribute("href"));

// The Übersicht sends a person holding no Funktion to Konto, so „Zurück“ there leads straight back to the page it
// stands on: a control that renders, takes a press and goes nowhere.
describe("the head of Konto's rail and the band over the list of its pages", () => {
  it("lead a person holding a Funktion back to the Übersicht", async () => {
    await renderFor();

    const team = ROUTES.teamOverview.path(seat().team_id, seat().saison_id);
    expect(backs()).toEqual([team, team]);
    expect(logos()).toEqual([]);
  });
});
