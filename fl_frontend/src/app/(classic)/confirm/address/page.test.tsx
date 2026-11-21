import { describe, expect, it } from "vitest";

import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";
import { serveBackend } from "@/test-support/backend";
import { arriveWith, doubleNextRequest } from "@/test-support/nextRequest";

import type { FLAddressChangeViewEnded, FLAddressChangeViewNew, FLAddressChangeViewPrevious } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

type View = FLAddressChangeViewNew | FLAddressChangeViewPrevious | FLAddressChangeViewEnded;

/** The view the backend serves for the link's token, which `stateFor` sets. */
let view: View | undefined;

/** Whether a request's body names the link's token, which the page posts rather than spells in an address. */
const carriesToken = (body: unknown) => typeof body === "object" && body !== null && "token" in body && body.token === "tok";

// The link's one read, for its own token alone: any other request goes unanswered, which fails the case.
serveBackend(({ method, path, body }) =>
  method === "POST" && path === "/address_change/confirmation/view" && carriesToken(body) && view !== undefined ? view : undefined,
);
// The read runs under the trace the edge sent, read off `next/headers`, which answers only inside Next's request.
doubleNextRequest();

const { default: AddressChangeConfirmationPage } = await import("./page");

const WORDS = SERVER_COPY.addressChange;
const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(served: View): Promise<MailedState> {
  view = served;
  // The link as the proxy left it: its token in the page's cookie.
  arriveWith({ cookie: "mailed_link=tok" });
  const page = AddressChangeConfirmationPage() as ReactElement<{ page: Promise<MailedState> }>;
  return page.props.page;
}

const live = { valid_until: "2026-11-05T10:00:00Z", effective_from: null, way: "account", email: null } as const;
const ended = { state: "ended", ended_on: DAY, way: "account", released_on: null, confirmed_on: null } as const;

// A link opened again after its answer offers no press the backend could refuse, so the end it shows is the only
// account of what happened: a change that took effect shown as a dead link misleads in silence.
describe("the person's own change, on a link opened again", () => {
  it("says the address on file confirmed it, and when, once it has", async () => {
    const state = await stateFor({ ...live, side: "previous", state: "open", released_on: DAY });
    expect(state).toMatchObject({ state: "end", title: COPY.shared.end.doneOn(WORDS.previous.confirmed, DAY) });
  });

  it("names each answer and its day once the change ended, and calls every other end void", async () => {
    expect(await stateFor({ ...ended, side: "new", kind: "effective" })).toMatchObject({
      title: COPY.shared.end.doneOn(WORDS.new.confirmed, DAY),
    });
    expect(await stateFor({ ...ended, side: "new", kind: "declined" })).toMatchObject({ tone: "danger" });
    expect(await stateFor({ ...ended, side: "previous", kind: "declined" })).toMatchObject({ tone: "danger" });
    // Confirmed first, then declined by the new mailbox: the address on file did confirm, on its own day.
    expect(await stateFor({ ...ended, side: "previous", kind: "declined", released_on: "2026-11-03" })).toMatchObject({
      title: COPY.shared.end.doneOn(WORDS.previous.confirmed, "2026-11-03"),
    });
    expect(await stateFor({ ...ended, side: "new", kind: "expired" })).toMatchObject({ state: "end", title: COPY.template.linkInvalid });
  });
});

// `ended_on` is the effect's day, a wait after the answer: a link opened again would state a day nobody confirmed on.
describe("a waited change, on a link opened again", () => {
  it("names the wait's day until it took effect, and the day the new mailbox confirmed after", async () => {
    const CONFIRMED = "2026-10-28";

    expect(
      await stateFor({ ...live, side: "new", state: "confirmed", confirmed_on: CONFIRMED, effective_from: "2026-11-04T10:00:00Z" }),
    ).toMatchObject({ state: "end", title: WORDS.new.confirmedFrom(DAY) });
    expect(await stateFor({ ...ended, side: "new", kind: "effective", confirmed_on: CONFIRMED })).toMatchObject({
      state: "end",
      title: COPY.shared.end.doneOn(WORDS.new.confirmed, CONFIRMED),
    });
  });
});

// The stop is the old address's one defence, on either way; shown as a dead link, nothing fails and the change goes through.
describe("the address on file's link", () => {
  const stops = { ...live, side: "previous", released_on: null, email: "l***@example.org" } as const;

  it("stops an administrator's change before the new mailbox confirmed", async () => {
    const state = await stateFor({ ...stops, way: "waiting_period", state: "open" });

    expect(state).toMatchObject({ state: "question", title: ACCOUNT_COPY.address.stop, acts: { primary: ACCOUNT_COPY.address.stop } });
  });

  it("stops a holder's change while its wait runs, and says from when it holds", async () => {
    const state = await stateFor({ ...stops, state: "waiting_period", effective_from: "2026-11-05T10:00:00Z" });

    expect(state).toMatchObject({ state: "question", title: ACCOUNT_COPY.address.stop });
    expect(state.state === "question" ? state.facts?.map(({ label }) => label) : []).toStrictEqual([
      WORDS.newAddress,
      COPY.shared.facts.effectiveFrom,
    ]);
  });

  it("says a stop was made, and when, once opened again", async () => {
    expect(await stateFor({ ...ended, side: "previous", kind: "stopped", way: "waiting_period" })).toMatchObject({
      title: COPY.shared.end.doneOn(WORDS.previous.stopped, DAY),
      tone: "danger",
    });
  });
});
