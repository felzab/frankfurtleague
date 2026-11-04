import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import AddressChangeConfirmationPage from "./page";

import type { FLAddressChangeViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

const read = vi.hoisted(() => ({ view: null as FLAddressChangeViewResponse["view"] | null, accountAtTheNewAddress: false }));

vi.mock("@/shared/utils/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/features/adresswechsel/mutations", async (original) => ({
  ...(await original<object>()),
  postAddressChangeView: async () => ({ view: read.view }),
}));
vi.mock("@/features/adresswechsel/konto", () => ({ accountAtNewAddress: async () => read.accountAtTheNewAddress }));

const WORDS = SERVER_COPY.addressChange;
const NEW_ADDRESS = "lenore.q@neupost.example.org";
const DAY = "2026-11-04";

/** What the page shows for the view the backend serves, as the template is handed it. */
async function stateFor(view: FLAddressChangeViewResponse["view"], accountAtTheNewAddress = false): Promise<MailedState> {
  read.view = view;
  read.accountAtTheNewAddress = accountAtTheNewAddress;
  const page = AddressChangeConfirmationPage({ params: Promise.resolve({}), searchParams: Promise.resolve({ token: "tok" }) }) as ReactElement<{
    page: Promise<MailedState>;
  }>;
  return page.props.page;
}

const live = { valid_until: "2026-11-05T10:00:00Z", effective_from: null, way: "account", email: null } as const;
const ended = { state: "ended", ended_on: DAY, way: "account", released_on: null } as const;

// Which state a link opens on decides what its holder may do: a used link offering its question again, or an
// opened-again link calling a done change void, misleads in silence.
describe("the person's own change, on each link", () => {
  it("asks the address on file its question, naming the new address", async () => {
    const state = await stateFor({ ...live, side: "previous", state: "release_open", email: NEW_ADDRESS, released_on: null });
    expect(state).toMatchObject({
      state: "frage",
      title: COPY.shared.withObject(WORDS.change, "confirm"),
      facts: [{ label: WORDS.newAddress, value: { record: NEW_ADDRESS } }],
      carry: { token: "tok", side: "previous" },
    });
  });

  it("calls the address on file's link void once its question lapsed", async () => {
    expect(await stateFor({ ...live, side: "previous", state: "release_expired", released_on: null })).toMatchObject({ state: "ungueltig" });
  });

  it("says the address on file confirmed it, and when, once it has", async () => {
    const state = await stateFor({ ...live, side: "previous", state: "open", released_on: DAY });
    expect(state).toMatchObject({ state: "schonErledigt", sentence: COPY.shared.end.doneOn(WORDS.previous.confirmed, DAY) });
  });

  it("asks the new mailbox its question, and calls it void where an account stands at the new address", async () => {
    const valid = { ...live, side: "new", state: "valid", email: NEW_ADDRESS, approval_open: null } as const;
    expect(await stateFor(valid)).toMatchObject({ state: "frage", carry: { token: "tok", side: "new" } });
    expect(await stateFor(valid, true)).toMatchObject({ state: "ungueltig" });
  });

  it("names each answer and its day once the change ended, and calls every other end void", async () => {
    expect(await stateFor({ ...ended, side: "new", art: "effective" })).toMatchObject({
      sentence: COPY.shared.end.doneOn(WORDS.new.confirmed, DAY),
    });
    expect(await stateFor({ ...ended, side: "new", art: "declined" })).toMatchObject({ declined: true });
    expect(await stateFor({ ...ended, side: "previous", art: "declined" })).toMatchObject({ declined: true });
    // Confirmed first, then declined by the new mailbox: the address on file did confirm, on its own day.
    expect(await stateFor({ ...ended, side: "previous", art: "declined", released_on: "2026-11-03" })).toMatchObject({
      sentence: COPY.shared.end.doneOn(WORDS.previous.confirmed, "2026-11-03"),
    });
    expect(await stateFor({ ...ended, side: "new", art: "expired" })).toMatchObject({ state: "ungueltig" });
  });
});

describe("the administrator's way", () => {
  it("keeps its old view", async () => {
    expect(await stateFor({ ...live, way: "waiting_period", side: "previous", state: "open", released_on: null })).toMatchObject({
      state: "alt",
    });
    expect(await stateFor({ ...ended, way: "waiting_period", side: "new", art: "effective" })).toMatchObject({ state: "alt" });
  });
});
