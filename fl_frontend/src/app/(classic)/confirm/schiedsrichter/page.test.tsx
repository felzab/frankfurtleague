import { TO_ACCOUNT } from "@/kit/MailedPage";
import { serveBackend } from "@/test-support/backend.ts";
import { doubleNextRequest } from "@/test-support/nextRequest.ts";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import type { FLSchiedsrichterConfirmationViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

/** The view the backend serves for the link's token, which `stateFor` sets. */
let view: FLSchiedsrichterConfirmationViewResponse | undefined;

/** Whether a request's body names the link's token, which the page posts rather than spells in an address. */
const carriesToken = (body: unknown) => typeof body === "object" && body !== null && "token" in body && body.token === "tok";

// The link's one read, for its own token alone: any other request goes unanswered, which fails the case.
serveBackend(({ method, path, body }) =>
  method === "POST" && path === "/schiedsrichter/confirmation/view" && carriesToken(body) ? view : undefined,
);
// The read runs under the trace the edge sent, read off `next/headers`, which answers only inside Next's request.
doubleNextRequest();

const { END, TO_HOME } = await import("./ends");
const { default: SchiedsrichterConfirmationPage } = await import("./page");

const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(served: Partial<FLSchiedsrichterConfirmationViewResponse>): Promise<MailedState> {
  view = { answered_at: null, deadline: "2026-11-18", maximum_age: 99, minimum_age: 16, state: "valid", ...served };
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
