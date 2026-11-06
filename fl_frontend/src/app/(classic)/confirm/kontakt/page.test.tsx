import { TO_ACCOUNT } from "@/kit/MailedPage";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { objectKontakt } from "./answerKontakt";
import { END, TO_HOME } from "./ends";
import KontaktConfirmationPage from "./page";

import type { FLBewerbungEinwilligungViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

const read = vi.hoisted(() => ({ view: null as FLBewerbungEinwilligungViewResponse | null }));

vi.mock("@/core/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/core/generated/client/sdk", async (original) => ({
  ...(await original<object>()),
  bewerbungenGetEinwilligungView: async () => read.view,
}));

const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(view: Partial<FLBewerbungEinwilligungViewResponse>): Promise<MailedState> {
  read.view = {
    quelle: "bewerbung",
    state: "valid",
    row: null,
    saison_id: "2027",
    schule: "Goethe-Gymnasium",
    rolle: "ansprechperson",
    also_rolle: null,
    minimum_age: 18,
    maximum_age: 99,
    deadline: "2026-11-18",
    answered_on: null,
    media_minimum_age: 18,
    ...view,
  };
  const page = KontaktConfirmationPage({
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
describe("a contact's link, opened again", () => {
  it("says the seat was confirmed, and when, leading to the account", async () => {
    expect(await stateFor({ state: "confirmed", answered_on: DAY })).toMatchObject({
      state: "alreadyDone",
      title: COPY.shared.end.doneOn(END.confirmed.title, DAY),
      next: TO_ACCOUNT,
    });
  });

  it("says the seat was objected to, and when, on the declined tint, leading home", async () => {
    expect(await stateFor({ state: "declined", answered_on: DAY })).toMatchObject({
      state: "alreadyDone",
      title: COPY.shared.end.doneOn(END.objected.title, DAY),
      next: TO_HOME,
      declined: true,
    });
  });
});

// The harm: a closed row's page reaches a review only through a seeded past season, and its press sent as the question's
// main act would post a confirmation the write refuses, leaving the person no way to object.
describe("a closed row's link", () => {
  it("offers the objection alone", async () => {
    expect(await stateFor({ quelle: "saison", state: "saison_past", row: "saison_past" })).toMatchObject({
      state: "question",
      action: objectKontakt,
      acts: { primary: COPY.shared.verb.oppose },
    });
  });
});
