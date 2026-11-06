import { TO_ACCOUNT } from "@/kit/MailedPage";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { END, TO_HOME } from "./ends";
import SchiedsrichterConfirmationPage, { generateMetadata } from "./page";

import type { FLSchiedsrichterConfirmationViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ResolvingMetadata } from "next";
import type { ReactElement } from "react";

const read = vi.hoisted(() => ({ view: null as FLSchiedsrichterConfirmationViewResponse | null }));

vi.mock("@/core/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/core/generated/client/sdk", async (original) => ({
  ...(await original<object>()),
  schiedsrichterGetConfirmationView: async () => read.view,
}));

const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(view: Partial<FLSchiedsrichterConfirmationViewResponse>): Promise<MailedState> {
  read.view = { answered_at: null, deadline: "2026-11-18", maximum_age: 99, minimum_age: 16, media_minimum_age: 18, state: "valid", ...view };
  const page = SchiedsrichterConfirmationPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({ token: "tok" }),
  }) as ReactElement<{
    page: Promise<MailedState>;
  }>;
  return page.props.page;
}

// A link opened again after its answer offers no press the backend could refuse, so the end it shows is the only
// account of what the person did: an objection shown as a confirmation, or the reverse, misleads in silence, and a
// review of the page meets one of these states at most, each needing a link of its own.
describe("a referee's link, opened again", () => {
  it("says the entry was confirmed, and when, leading to the account", async () => {
    expect(await stateFor({ state: "confirmed", answered_at: DAY })).toMatchObject({
      state: "alreadyDone",
      title: COPY.shared.end.doneOn(END.confirmed.title, DAY),
      next: TO_ACCOUNT,
    });
  });

  it("says the entry was objected to, and when, on the declined tint, leading home", async () => {
    expect(await stateFor({ state: "declined", answered_at: DAY })).toMatchObject({
      state: "alreadyDone",
      title: COPY.shared.end.doneOn(END.objected.title, DAY),
      next: TO_HOME,
      declined: true,
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
