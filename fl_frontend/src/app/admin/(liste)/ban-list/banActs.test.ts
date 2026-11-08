import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble";
import { refused } from "@/test-support/refusals";
import { bodyField, refusedPayload } from "@/test-support/refusedPayload";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

const HOLDER = "admin@example.org";
const ADDRESS = "max@example.org";
const BAN = { email: ADDRESS, ban_reason: "Ein Grund", holder: HOLDER };
const PARTIAL = COPY.admin.banList.partial;

/** What the sign-in store answers, and the order a ban reached it and the backend in. */
const store = vi.hoisted(() => ({
  account: async (): Promise<boolean> => true,
  end: async (): Promise<boolean> => true,
  stand: async (): Promise<boolean> => false,
  reached: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({
  judgeAdminRequest: async () => {
    (await import("@/core/requestScope")).setRequestActor({ email: "admin@example.org", lane: "admin", authTime: 0, factor: "passkey" });
    return { session: {} };
  },
  passesPasskeyTouch: async () => true,
}));
vi.mock("@/core/auth/accounts", () => ({ accountStandsAt: () => store.account() }));
vi.mock("@/core/auth/accountSessions", () => ({
  endSessionsOfAddress: async (address: string) => {
    store.reached.push(`end ${address}`);
    return store.end();
  },
  sessionsStandAt: () => store.stand(),
}));

const { calls, answerWith } = doubleApiAnswers(async () => {
  store.reached.push("post");
  return {};
});

const { enterBan } = await import("./banActs");

const failing = async (): Promise<never> => {
  throw new Error("the store is away");
};

beforeEach(() => {
  store.account = async () => true;
  store.end = async () => true;
  store.stand = async () => false;
  store.reached = [];
});

describe("a ban", () => {
  // No static check holds this: a ban that skipped it reads as done while the person stays signed in, for as long as
  // their session lasts.
  it("ends the address's sessions once the write stands, and says nothing more", async () => {
    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined });

    expect(store.reached).toStrictEqual(["post", `end ${ADDRESS}`]);
    expect(requestsOf(calls).at(-1)?.body).toStrictEqual({ email: ADDRESS, ban_reason: "Ein Grund", notify: true });
  });

  it("owes no notice where no account stands, and that is no partial outcome", async () => {
    store.account = async () => false;

    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined });

    expect(requestsOf(calls).at(-1)?.body).toMatchObject({ notify: false });
    expect(store.reached).toContain(`end ${ADDRESS}`);
  });

  // Each stands behind a write that cannot be taken back, so the dialog must say what did not follow.
  it.each([
    ["the sign-out failed", { end: failing }, PARTIAL.sessions],
    ["both", { end: failing, account: failing }, PARTIAL.both],
  ])("keeps its button for a second press and says what did not follow where %s", async (_case, failures, reason) => {
    Object.assign(store, failures);

    expect(await enterBan(BAN)).toStrictEqual({ ok: false, reason, warn: true });

    expect(store.reached).toContain("post");
  });

  it("stands done and says so where the store did not say whether an account stands, which no press repairs", async () => {
    store.account = failing;

    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined, note: PARTIAL.notice, warn: true });
  });

  // A POST whose answer was lost leaves the ban standing and the sign-out never run, and nothing but this press ends it.
  describe("a second ban", () => {
    beforeEach(() => {
      answerWith(async () => {
        throw refused("duplicate_key");
      });
    });

    it("is refused on the address's box where nothing was left to end", async () => {
      expect(await enterBan(BAN)).toMatchObject({ ok: false, fieldErrors: { email: SERVER_COPY.refusal.duplicate_key } });

      expect(store.reached).toStrictEqual([`end ${ADDRESS}`]);
    });

    // The harm: „Schon vergeben“ over a press that did what the warn line left open reads as nothing having happened.
    it("says the sessions the first left running ended, and refuses nothing", async () => {
      store.stand = async () => true;

      expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined, note: PARTIAL.ended });

      expect(store.reached).toStrictEqual([`end ${ADDRESS}`]);
    });

    // The harm: a field error stands on the box until its value changes, so the browser holds back the press that still could.
    it.each([
      ["they run", async () => true],
      ["the store did not say", failing],
    ])("says so where they did not end and %s, and leaves the address free to press again", async (_case, stand) => {
      store.stand = stand;
      store.end = failing;

      expect(await enterBan(BAN)).toStrictEqual({ ok: false, reason: PARTIAL.sessions, warn: true });
    });
  });

  // The list of codes the screen words is held by nothing else: the shared failure line sends a retry the same rule refuses.
  it.each([
    ["an address holding a grant", refused("ban_list_admin"), { reason: SERVER_COPY.refusalLine.ban_list_admin }],
    ["no season running", refused("ban_list_no_saison"), { reason: SERVER_COPY.refusalLine.ban_list_no_saison }],
    [
      "an address in the Grund",
      refusedPayload([bodyField(["ban_reason"], "address_in_free_text")]),
      { fieldErrors: { ban_reason: COPY.shared.field.without(COPY.signIn.address) } },
    ],
    [
      "an address the backend cannot mail",
      refusedPayload([bodyField(["email"], "email_not_accepted")]),
      { fieldErrors: { email: COPY.shared.field.format(COPY.shared.field.exampleAddress) } },
    ],
  ])("refuses %s in the screen's words and ends no session", async (_case, refusal, answer) => {
    answerWith(async () => {
      throw refusal;
    });

    expect(await enterBan(BAN)).toMatchObject({ ok: false, ...answer });

    expect(store.reached).toStrictEqual([]);
  });
});
