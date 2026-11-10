import { TO_ACCOUNT } from "@/kit/MailedPage";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { CONFIRMED } from "./ends";
import RegistrierungConfirmationPage, { generateMetadata } from "./page";

import type { FLRegistrierungConfirmationViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ResolvingMetadata } from "next";
import type { ReactElement } from "react";

const read = vi.hoisted(() => ({ view: null as FLRegistrierungConfirmationViewResponse | null }));

vi.mock("@/core/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/core/generated/client/sdk", async (original) => ({
  ...(await original<object>()),
  registrierungenGetConfirmationView: async () => read.view,
}));

const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(view: Partial<FLRegistrierungConfirmationViewResponse>): Promise<MailedState> {
  read.view = {
    answered_at: null,
    deadline: "2026-11-18",
    media_minimum_age: 18,
    minimum_age: 16,
    saison_id: "2027",
    schule: "Kastanie-Gymnasium",
    state: "valid",
    team: "Kastanie",
    ...view,
  };
  const page = RegistrierungConfirmationPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({ token: "tok" }),
  }) as ReactElement<{
    page: Promise<MailedState>;
  }>;
  return page.props.page;
}

// The harm: a link opened again after its answer asking the question again, whose press the write refuses, or saying
// nothing of when the pupil answered; a review of the page meets this state only with a link of its own.
describe("a pupil's link, opened again", () => {
  it("says the registration was confirmed, and when, leading to the account", async () => {
    expect(await stateFor({ state: "confirmed", answered_at: DAY })).toStrictEqual({
      state: "alreadyDone",
      title: COPY.shared.end.doneOn(CONFIRMED.title, DAY),
      next: TO_ACCOUNT,
    });
  });
});

// The harm: a tab asking for an answer over a page saying the link is dead, which no reading of the page meets.
describe("the tab's title", () => {
  it("says the link is dead where the page does", async () => {
    const parent = Promise.resolve({}) as unknown as ResolvingMetadata;

    expect((await generateMetadata({ searchParams: Promise.resolve({}) }, parent)).title).toBe(COPY.template.linkInvalid);
  });
});
