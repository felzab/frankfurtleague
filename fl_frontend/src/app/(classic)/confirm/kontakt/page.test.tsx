import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { TO_HOME } from "@/kit/mailedLinkState";
import { TO_ACCOUNT } from "@/kit/MailedPage";
import { serveBackend } from "@/test-support/backend";
import { arriveWith, doubleNextRequest } from "@/test-support/nextRequest";

import type { FLBewerbungEinwilligungViewAnswered, FLBewerbungEinwilligungViewSaisonPast } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

/** The views these cases serve: a link opened again, and a closed row's. */
type View = FLBewerbungEinwilligungViewAnswered | FLBewerbungEinwilligungViewSaisonPast;

/** The view the backend serves for the link's token, which `stateFor` sets. */
let view: View | undefined;

/** Whether a request's body names the link's token, which the page posts rather than spells in an address. */
const carriesToken = (body: unknown) => typeof body === "object" && body !== null && "token" in body && body.token === "tok";

// The link's one read, for its own token alone: any other request goes unanswered, which fails the case.
serveBackend(({ method, path, body }) =>
  method === "POST" && path === "/bewerbungen/confirmation/view" && carriesToken(body) ? view : undefined,
);
// The read runs under the trace the edge sent, read off `next/headers`, which answers only inside Next's request.
doubleNextRequest();

const { objectKontakt } = await import("./answerKontakt");
const { END } = await import("../ends");
const { default: KontaktConfirmationPage } = await import("./page");

const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(served: View): Promise<MailedState> {
  view = served;
  // The link as the proxy left it: its token in the page's cookie.
  arriveWith({ cookie: "mailed_link=tok" });
  const page = KontaktConfirmationPage() as ReactElement<{ page: Promise<MailedState> }>;
  return page.props.page;
}

// A link opened again after its answer offers no press the backend could refuse, so the end it shows is the only
// account of what the person did: an objection shown as a confirmation, or the reverse, misleads in silence, and a
// review of the page meets one of these states at most, each needing a link of its own.
describe("a contact's link, opened again", () => {
  it("says the seat was confirmed, and when, leading to the account", async () => {
    expect(await stateFor({ state: "confirmed", answered_at: DAY })).toMatchObject({
      state: "end",
      tone: "info",
      title: COPY.shared.end.doneOn(END.confirmed.title, DAY),
      next: TO_ACCOUNT,
    });
  });

  it("says the seat was objected to, and when, on the declined tint, leading home", async () => {
    expect(await stateFor({ state: "declined", answered_at: DAY })).toMatchObject({
      state: "end",
      tone: "danger",
      title: COPY.shared.end.doneOn(END.objected.title, DAY),
      next: TO_HOME,
    });
  });
});

// The harm: a closed row's page reaches a review only through a seeded past season, and its press sent as the question's
// main act would post a confirmation the write refuses, leaving the person no way to object.
describe("a closed row's link", () => {
  it("offers the objection alone", async () => {
    const closed = {
      state: "saison_past",
      record: "saison",
      row: "saison_past",
      saison_id: "2027",
      schule: "Goethe-Gymnasium",
      seat: "ansprechperson",
      also_seat: null,
    } as const;
    expect(await stateFor(closed)).toMatchObject({
      state: "question",
      run: objectKontakt,
      acts: { refusal: { verb: "oppose" } },
    });
  });
});
