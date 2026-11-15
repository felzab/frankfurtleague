import { TO_ACCOUNT } from "@/kit/MailedPage";
import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import type { FLBewerbungEinwilligungViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

/** The view the backend serves for the link's token, which `stateFor` sets. */
let view: FLBewerbungEinwilligungViewResponse | undefined;

/** Whether a request's body names the link's token, which the page posts rather than spells in an address. */
const carriesToken = (body: unknown) => typeof body === "object" && body !== null && "token" in body && body.token === "tok";

// The link's one read, for its own token alone: any other request goes unanswered, which fails the case.
serveBackend(({ method, path, body }) =>
  method === "POST" && path === "/bewerbungen/einwilligung/view" && carriesToken(body) ? view : undefined,
);
// The read runs under the trace the edge sent, read off `next/headers`, which answers only inside Next's request.
doubleNextRequest();

const { objectKontakt } = await import("./answerKontakt");
const { END, TO_HOME } = await import("./ends");
const { default: KontaktConfirmationPage } = await import("./page");

const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(served: Partial<FLBewerbungEinwilligungViewResponse>): Promise<MailedState> {
  view = {
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
    answered_at: null,
    ...served,
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
    expect(await stateFor({ state: "confirmed", answered_at: DAY })).toMatchObject({
      state: "alreadyDone",
      title: COPY.shared.end.doneOn(END.confirmed.title, DAY),
      next: TO_ACCOUNT,
    });
  });

  it("says the seat was objected to, and when, on the declined tint, leading home", async () => {
    expect(await stateFor({ state: "declined", answered_at: DAY })).toMatchObject({
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
      acts: { refusal: { verb: "oppose" } },
    });
  });
});
