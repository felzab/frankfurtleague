import { describe, expect, it, vi } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import BewerbungRootPage from "./page";

import type { FLBewerbungFormResponse, FLLandingResponse } from "@/core/generated/client/types";
import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

/** The landing's window and the season's form each case serves. */
const read = vi.hoisted(() => ({
  window: null as FLLandingResponse["bewerbung_window"],
  form: null as FLBewerbungFormResponse | null,
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/core/traceScope", () => ({ runWithIncomingTrace: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock("../landing", () => ({
  readLanding: async (): Promise<Partial<FLLandingResponse>> => ({
    bewerbung_window: read.window,
    bewerbung_opens_on: null,
    bewerbung_window_held: false,
  }),
}));
vi.mock("@/core/generated/client/sdk", async (original) => ({
  ...(await original<object>()),
  bewerbungenGetForm: async () => read.form,
}));

/** What the page shows, as the template is handed it. */
async function state(): Promise<MailedState> {
  return (BewerbungRootPage() as ReactElement<{ page: Promise<MailedState> }>).props.page;
}

// The harm: the footer's one way to applying leads every visitor here, so an address that showed no form while a window
// runs, or failed while none does, loses applications in silence.
describe("the application's address naming no season", () => {
  it("draws the form of the season whose window runs", async () => {
    read.window = { saison_id: "2028", end: "2028-01-31" };
    read.form = { schulen: [], taken: [], window: { start: "2027-12-01", state: "running" } };
    expect(await state()).toMatchObject({ state: "question", carry: { saison_id: "2028" } });
  });

  it("draws the closed card while no window runs", async () => {
    read.window = null;
    expect(await state()).toMatchObject({ state: "end", title: SERVER_COPY.bewerbung.end.closed });
  });
});
