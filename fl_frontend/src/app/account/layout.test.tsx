// @vitest-environment jsdom
import { underNext } from "@/test-support/nextContexts";
import { person, seat } from "@/test-support/subjectFixtures";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import AccountLayout from "./layout";

import type { SubjectSession } from "@/core/subject";

/** The session read each case's frame makes, settled by the case. */
const session = vi.hoisted(() => ({ read: Promise.resolve<unknown>(null) }));
vi.mock("@/core/subject", () => ({ getSubjectSession: () => session.read }));
// The account's other guard, which Konto's pages ask and its frame does not: its module opens the sign-in store.
vi.mock("@/core/auth/guards", () => ({ getAccountSession: () => Promise.resolve(null) }));

/** Konto's frame at its Sicherheit page, for the person the session read answers. */
async function renderFor(read: Promise<SubjectSession>) {
  session.read = read;
  await act(async () =>
    render(
      underNext(
        <AccountLayout>
          <p>Seite</p>
        </AccountLayout>,
        { pathname: ROUTES.accountSecurity.path(), params: {} },
      ),
    ),
  );
}

const back = () => screen.queryByRole("link", { name: COPY.shared.back });
const logo = () => screen.queryByRole("link", { name: COPY.brand.name });
/** The rail's head, the dark-green band over the menu, where the way back or the logo stands. */
const head = () => screen.getByRole("complementary").firstElementChild;

// The Übersicht sends a person holding no Funktion to Konto, so „Zurück“ there leads straight back to the page it
// stands on: a control that renders, takes a press and goes nowhere.
describe("the head of Konto's rail", () => {
  it("leads a person holding a Funktion back to the Übersicht", async () => {
    await renderFor(Promise.resolve(person({ seats: [seat()] })));

    expect(back()?.getAttribute("href")).toBe(ROUTES.area.path());
    expect(logo()).toBeNull();
  });

  it("holds the logo for a person holding none", async () => {
    await renderFor(Promise.resolve(person()));

    expect(back()).toBeNull();
    expect(logo()?.getAttribute("href")).toBe(ROUTES.home.path());
  });

  it("holds neither while the session is read, the way back's own placeholder standing in its place", async () => {
    await renderFor(new Promise(() => undefined));

    expect(back()).toBeNull();
    expect(logo()).toBeNull();
    expect(head()?.querySelector("[aria-hidden]")).not.toBeNull();
  });
});
