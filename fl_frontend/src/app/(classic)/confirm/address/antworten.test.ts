import { beforeEach, describe, expect, it, vi } from "vitest";

import { LINK_INVALID } from "./ends";

import type { FLAddressChangeAnswerResponse } from "@/core/generated/client/types";

const held = vi.hoisted(() => ({
  accountAtTheNewAddress: false,
  answered: null as FLAddressChangeAnswerResponse | null,
  posted: [] as unknown[],
  carry: (): Promise<void> => Promise.resolve(),
  carries: 0,
  logged: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
vi.mock("@/core/logging", () => ({
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message: string) => void held.logged.push(message),
  },
}));
vi.mock("@/features/adresswechsel/konto", () => ({ kontoAnNeuerAdresse: async () => held.accountAtTheNewAddress }));
vi.mock("@/features/adresswechsel/mutations", async (original) => ({
  ...(await original<object>()),
  postAdresswechselAntwort: async (payload: unknown) => {
    held.posted.push(payload);
    if (held.answered === null) throw new Error("the case answered no press");
    return held.answered;
  },
}));
vi.mock("@/features/adresswechsel/umzug", () => ({
  runAdresswechselUmzuege: () => {
    held.carries += 1;
    return held.carry();
  },
}));

const { adresseBeantworten } = await import("./antworten");

const TOKEN = "tok_abc";
const EFFECTIVE: FLAddressChangeAnswerResponse = { answer: "confirmed", effective: true, effective_from: null, approval_open: false };

beforeEach(() => {
  held.accountAtTheNewAddress = false;
  held.answered = null;
  held.posted = [];
  held.carry = () => Promise.resolve();
  held.carries = 0;
  held.logged = [];
});

// The view's refusal guards the page as it opened; an account opened between the view and the press is this press's
// alone to refuse, and without it the change takes effect onto an address whose own account the carry then leaves
// standing.
describe("the new mailbox's press, an account standing at the new address", () => {
  it("is refused as the link no longer valid, and nothing is posted", async () => {
    held.accountAtTheNewAddress = true;

    expect(await adresseBeantworten({ token: TOKEN, side: "new", act: "primary" })).toStrictEqual({ ok: true, value: LINK_INVALID });
    expect(held.posted).toStrictEqual([]);
  });

  it("still declines, and the address on file's confirmation is not refused", async () => {
    held.accountAtTheNewAddress = true;
    held.answered = { answer: "declined", effective: false, effective_from: null, approval_open: false };
    await adresseBeantworten({ token: TOKEN, side: "new", act: "secondary" });

    held.answered = { answer: "confirmed", effective: false, effective_from: null, approval_open: false };
    await adresseBeantworten({ token: TOKEN, side: "previous", act: "primary" });

    expect(held.posted).toStrictEqual([
      { token: TOKEN, answer: "declined" },
      { token: TOKEN, answer: "confirmed" },
    ]);
  });
});

// The done end invites the sign-in at the new address, which opens an empty account there while the carry is owed.
describe("the effect's account carry", () => {
  it("is made before the press answers", async () => {
    held.answered = EFFECTIVE;
    let release: () => void = () => undefined;
    held.carry = () => new Promise((resolve) => (release = resolve));

    let settled = false;
    const answer = adresseBeantworten({ token: TOKEN, side: "new", act: "primary" }).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(held.carries).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release();
    expect(await answer).toMatchObject({ ok: true, value: { tone: "success" } });
  });

  it("answers the done end where the carry fails, the hourly pass owing it, and logs the failure", async () => {
    held.answered = EFFECTIVE;
    held.carry = () => Promise.reject(new Error("the sign-in store is away"));

    expect(await adresseBeantworten({ token: TOKEN, side: "new", act: "primary" })).toMatchObject({ ok: true, value: { tone: "success" } });
    expect(held.logged).toStrictEqual(["address_change.carry_failed"]);
  });
});
