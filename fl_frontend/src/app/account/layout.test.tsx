// @vitest-environment jsdom
import { underNext } from "@/test-support/nextContexts";
import { person, seat } from "@/test-support/subjectFixtures";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import AccountListLayout from "./(list)/layout";
import AccountLayout from "./layout";

import type { SubjectSession } from "@/core/subject";

/** The session read each case's frame makes, settled by the case. */
const session = vi.hoisted(() => ({ read: Promise.resolve<unknown>(null) }));
vi.mock("@/core/subject", () => ({ getSubjectSession: () => session.read }));
// The account's other guard, which Konto's pages ask and its frame does not: its module opens the sign-in store.
vi.mock("@/core/auth/guards", () => ({ getAccountSession: () => Promise.resolve(null) }));

/** Konto's frame around the list of its pages, for the person the session read answers. */
async function renderFor(read: Promise<SubjectSession>) {
  session.read = read;
  await act(async () =>
    render(
      underNext(
        <AccountLayout>
          <AccountListLayout>
            <p>Seite</p>
          </AccountListLayout>
        </AccountLayout>,
        { pathname: ROUTES.account.path(), params: {} },
      ),
    ),
  );
}

/** Where each „‹ Zurück“ leads and each logo, the rail's head's and the phone's band's. */
const backs = () => screen.queryAllByRole("link", { name: COPY.shared.back }).map((link) => link.getAttribute("href"));
const logos = () => screen.queryAllByRole("link", { name: COPY.brand.name }).map((link) => link.getAttribute("href"));

// The Übersicht sends a person holding no Funktion to Konto, so „Zurück“ there leads straight back to the page it
// stands on: a control that renders, takes a press and goes nowhere.
describe("the head of Konto's rail and the band over the list of its pages", () => {
  it("lead a person holding a Funktion back to the Übersicht", async () => {
    await renderFor(Promise.resolve(person({ seats: [seat()] })));

    expect(backs()).toEqual([ROUTES.area.path(), ROUTES.area.path()]);
    expect(logos()).toEqual([]);
  });

  it("hold the logo for a person holding none", async () => {
    await renderFor(Promise.resolve(person()));

    expect(backs()).toEqual([]);
    expect(logos()).toEqual([ROUTES.home.path(), ROUTES.home.path()]);
  });

  it("hold neither while the session is read", async () => {
    await renderFor(new Promise(() => undefined));

    expect(backs()).toEqual([]);
    expect(logos()).toEqual([]);
  });
});
