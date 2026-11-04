import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import AddressChangeConfirmationPage from "./page";

import type { FLAddressChangeViewResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

const read = vi.hoisted(() => ({ view: null as FLAddressChangeViewResponse["view"] | null }));

vi.mock("@/core/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("@/features/adresswechsel/mutations", async (original) => ({
  ...(await original<object>()),
  postAddressChangeView: async () => ({ view: read.view }),
}));
vi.mock("@/features/adresswechsel/konto", () => ({ accountAtNewAddress: async () => false }));

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
const ended = { state: "ended", ended_on: DAY, way: "account", released_on: null } as const;

// A link opened again after its answer offers no press the backend could refuse, so the end it shows is the only
// account of what happened: a change that took effect shown as a dead link misleads in silence.
describe("the person's own change, on a link opened again", () => {
  it("says the address on file confirmed it, and when, once it has", async () => {
    const state = await stateFor({ ...live, side: "previous", state: "open", released_on: DAY });
    expect(state).toMatchObject({ state: "schonErledigt", sentence: COPY.shared.end.doneOn(WORDS.previous.confirmed, DAY) });
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
