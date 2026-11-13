import { doubleApiClient } from "@/test-support/apiClientDouble";
import { refused } from "@/test-support/refusals";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

/** Every step of an erasure in its order, the backend's refusal or the account's failure each case sets, and the log. */
const state = vi.hoisted(() => ({
  steps: [] as string[],
  refusal: null as unknown,
  accountFailure: null as unknown,
  logged: [] as unknown[],
  view: {} as Record<string, number>,
  holdings: { account: 0, passkeys: 0 },
}));

const HOLDER = "pia@example.org";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/auth/guards", () => ({ judgeAdminRequest: async () => ({ session: {} }), passesPasskeyTouch: async () => true }));
vi.mock("@/core/requestScope", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRequestActor: () => ({ email: "pia@example.org" }),
}));
vi.mock("@/core/logging", () => ({ logger: { error: (...line: unknown[]) => void state.logged.push(line) } }));
vi.mock("@/core/auth/accounts", () => ({
  accountHoldingsAt: async () => state.holdings,
  deleteAccountFor: async () => {
    state.steps.push("account");
    if (state.accountFailure !== null) throw state.accountFailure;
    return true;
  },
}));

doubleApiClient(({ endpoint }) => {
  if (endpoint.endsWith("/view")) return state.view;
  state.steps.push("records");
  if (state.refusal !== null) throw state.refusal;
  return {};
});

const { eraseAddress, readErasureCounts } = await import("./erasureActs");

const press = () => eraseAddress({ email: "max@example.org", reason: "Mail vom 3.11.2026", holder: HOLDER });

const NO_RECORDS = {
  spieler: 0,
  schiedsrichter: 0,
  kontakt_seats: 0,
  bewerbung_seats: 0,
  registrierungen: 0,
  spiele: 0,
  address_change: 0,
  grants: 0,
};

const asked = async () => {
  const answer = await readErasureCounts({ email: "max@example.org", reason: "Mail vom 3.11.2026" });
  assert(answer.ok);
  return answer.value.question;
};

beforeEach(() => {
  state.view = NO_RECORDS;
  state.holdings = { account: 0, passkeys: 0 };
  state.steps.length = 0;
  state.logged.length = 0;
  state.refusal = null;
  state.accountFailure = null;
});

describe("the erasure's question", () => {
  // The harm: „Unter dieser Adresse steht nichts.“ over an account the act then deletes.
  it("counts an address holding its account alone, each row above zero and no other", async () => {
    state.holdings = { account: 1, passkeys: 2 };

    expect(await asked()).toMatchObject({
      consequence: COPY.admin.erasure.consequence,
      facts: [
        { label: COPY.template.account, value: { record: "1" } },
        { label: COPY.account.passkeys.title, value: { record: "2" } },
      ],
    });
  });

  it("says an address holds nothing only where the league and the sign-in store both do", async () => {
    expect(await asked()).toMatchObject({ consequence: COPY.admin.nothingAtAddress, facts: [] });
  });
});

describe("the erasure's two stores", () => {
  it("deletes the account after the records, and says so", async () => {
    expect(await press()).toStrictEqual({ ok: true, value: undefined, note: COPY.admin.erased });
    expect(state.steps).toStrictEqual(["records", "account"]);
  });

  it("leaves the account standing where the backend refuses the records", async () => {
    state.refusal = refused("own_address");

    expect(await press()).toMatchObject({ ok: false, reason: SERVER_COPY.refusalLine.own_address });
    expect(state.steps).toStrictEqual(["records"]);
  });

  it.each([["of unknown outcome", new Error("max@example.org")]])(
    "stays open on an account deletion %s, logging no address",
    async (_, failure) => {
      state.accountFailure = failure;

      // Not done: the dialog stands on this answer, and its press repeats the erasure, the one way to reach the account.
      expect(await press()).toStrictEqual({ ok: false, reason: COPY.admin.erasure.partial, warn: true });
      expect(JSON.stringify(state.logged)).not.toContain("max@example.org");
      expect(state.logged).toHaveLength(1);
    },
  );
});
