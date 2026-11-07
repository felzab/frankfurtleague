import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import AddressChangeConfirmationPage, { generateMetadata } from "./page";

import type { FLAddressChangeViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ResolvingMetadata } from "next";
import type { ReactElement } from "react";

const read = vi.hoisted(() => ({ view: null as FLAddressChangeViewResponse["view"] | null }));

vi.mock("@/core/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/features/address-change/mutations", async (original) => ({
  ...(await original<object>()),
  postAddressChangeView: async () => ({ view: read.view }),
}));
vi.mock("@/features/address-change/account", () => ({ accountAtNewAddress: async () => false }));

const WORDS = SERVER_COPY.addressChange;
const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(view: FLAddressChangeViewResponse["view"]): Promise<MailedState> {
  read.view = view;
  const page = AddressChangeConfirmationPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ token: "tok" }) }) as ReactElement<{
    page: Promise<MailedState>;
  }>;
  return page.props.page;
}

const live = { valid_until: "2026-11-05T10:00:00Z", effective_from: null, way: "account", email: null } as const;
const ended = { state: "ended", ended_on: DAY, way: "account", released_on: null, confirmed_on: null } as const;

// A link opened again after its answer offers no press the backend could refuse, so the end it shows is the only
// account of what happened: a change that took effect shown as a dead link misleads in silence.
describe("the person's own change, on a link opened again", () => {
  it("says the address on file confirmed it, and when, once it has", async () => {
    const state = await stateFor({ ...live, side: "previous", state: "open", released_on: DAY });
    expect(state).toMatchObject({ state: "alreadyDone", title: COPY.shared.end.doneOn(WORDS.previous.confirmed, DAY) });
  });

  it("names each answer and its day once the change ended, and calls every other end void", async () => {
    expect(await stateFor({ ...ended, side: "new", kind: "effective" })).toMatchObject({
      title: COPY.shared.end.doneOn(WORDS.new.confirmed, DAY),
    });
    expect(await stateFor({ ...ended, side: "new", kind: "declined" })).toMatchObject({ declined: true });
    expect(await stateFor({ ...ended, side: "previous", kind: "declined" })).toMatchObject({ declined: true });
    // Confirmed first, then declined by the new mailbox: the address on file did confirm, on its own day.
    expect(await stateFor({ ...ended, side: "previous", kind: "declined", released_on: "2026-11-03" })).toMatchObject({
      title: COPY.shared.end.doneOn(WORDS.previous.confirmed, "2026-11-03"),
    });
    expect(await stateFor({ ...ended, side: "new", kind: "expired" })).toMatchObject({ state: "invalid" });
  });
});

// `ended_on` is the effect's day, a wait after the answer: a link opened again would state a day nobody confirmed on.
describe("a waited change, on a link opened again", () => {
  it("names the day the new mailbox confirmed, in the wait and once it took effect", async () => {
    const CONFIRMED = "2026-10-28";
    const title = COPY.shared.end.doneOn(WORDS.new.confirmed, CONFIRMED);

    expect(await stateFor({ ...live, side: "new", state: "confirmed", confirmed_on: CONFIRMED })).toMatchObject({
      state: "alreadyDone",
      title,
    });
    expect(await stateFor({ ...ended, side: "new", kind: "effective", confirmed_on: CONFIRMED })).toMatchObject({
      state: "alreadyDone",
      title,
    });
  });
});

// The stop is the old address's one defence, on either way; shown as a dead link, nothing fails and the change goes through.
describe("the address on file's link", () => {
  const stops = { ...live, side: "previous", released_on: null, email: "l***@example.org" } as const;

  it("stops an administrator's change before the new mailbox confirmed", async () => {
    const state = await stateFor({ ...stops, way: "waiting_period", state: "open" });

    expect(state).toMatchObject({ state: "question", title: COPY.account.address.stop, acts: { primary: COPY.account.address.stop } });
  });

  it("stops a holder's change while its wait runs, and says from when it holds", async () => {
    const state = await stateFor({ ...stops, state: "waiting_period", effective_from: "2026-11-05T10:00:00Z" });

    expect(state).toMatchObject({ state: "question", title: COPY.account.address.stop });
    expect(state.state === "question" ? state.facts?.map(({ label }) => label) : []).toStrictEqual([
      WORDS.newAddress,
      COPY.admin.facts.effectiveFrom,
    ]);
  });

  it("says a stop was made, and when, once opened again", async () => {
    expect(await stateFor({ ...ended, side: "previous", kind: "stopped", way: "waiting_period" })).toMatchObject({
      title: COPY.shared.end.doneOn(WORDS.previous.stopped, DAY),
      declined: true,
    });
  });

  // The new mailbox's decline of an administrator's change is no answer of this link's, so naming one would be false.
  it("calls an administrator's change the new mailbox declined void", async () => {
    expect(await stateFor({ ...ended, side: "previous", kind: "declined", way: "waiting_period" })).toMatchObject({ state: "invalid" });
  });
});

// The harm: a tab asking for an answer over a page saying the link is dead, which no reading of the page meets.
describe("the tab's title", () => {
  it("says the link is dead where the page does", async () => {
    const parent = Promise.resolve({}) as unknown as ResolvingMetadata;

    expect((await generateMetadata({ searchParams: Promise.resolve({}) }, parent)).title).toBe(COPY.template.linkInvalid);
  });
});
