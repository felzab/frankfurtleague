import { beforeEach, describe, expect, it, vi } from "vitest";

import AccountErasurePage from "./page";

import type { MailedState } from "@/kit/MailedPage";
import type { ReactElement } from "react";

/** What the guards and the reads answer, which each case sets. */
const held = vi.hoisted(() => ({ account: null as object | null, passkeys: 0 }));

vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
// An address holding a grant, signed in by its mailed code: the person guard admits it, the account's guard does not.
vi.mock("@/core/subject", () => ({ getSubjectSession: async () => ({ email: "verwalterin@example.org", admin: false, subject: {} }) }));
vi.mock("@/core/auth/guards", () => ({ getAccountSession: async () => held.account }));
vi.mock("@/core/auth/session", () => ({ readRequestSession: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/core/auth/passkeys", () => ({ passkeysOf: async () => Array.from({ length: held.passkeys }, () => ({})) }));
vi.mock("@/features/konto/queries", () => ({
  getErasureView: async () => ({
    spieler: [],
    schiedsrichter: [],
    seats: [],
    bewerbungen: [],
    registrierungen: [],
    address_change: 0,
    verwaltung: "administration",
    last_owner: false,
  }),
}));
vi.mock("@/features/konto/personActions", () => ({ eraseAccount: async () => ({ ok: false }) }));

/** What the page opens on for the link `token`. */
const opened = (token: string) =>
  (
    AccountErasurePage({ params: Promise.resolve({}), searchParams: Promise.resolve({ token }) }) as ReactElement<{
      page: Promise<MailedState>;
    }>
  ).props.page;

beforeEach(() => {
  held.account = null;
  held.passkeys = 0;
});

/* The press is judged by the account's guard: a question the page asks of a session that guard refuses is a press
   answered „Deine Anmeldung ist abgelaufen.“ after the person read what goes. */
describe("the deletion link's page for a session the account's guard refuses", () => {
  it("sends an administrator holding no passkey to the landing, carrying the link back", async () => {
    await expect(opened("abc")).rejects.toThrow("redirect /signin/continue?return=%2Ferasure%3Ftoken%3Dabc");
  });

  it("asks a passkey holder the question behind the touch, which makes the session that guard admits", async () => {
    held.passkeys = 1;

    expect(await opened("abc")).toMatchObject({ state: "frage", touch: true });
  });
});
