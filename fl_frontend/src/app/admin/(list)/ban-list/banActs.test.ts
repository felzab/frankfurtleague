import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import type { FLPostBanListEntryPayload, FLPostBanListEntryResponse } from "@/core/generated/client/types";

const ADDRESS = "max@example.org";
const BAN = { email: ADDRESS, ban_reason: "Ein Grund", holder: ADMIN_EMAIL };
const PARTIAL = COPY.admin.banList.partial;
const MAX_ID = "64c000000000000000000005";

/** The sessions of the banned address's account the store held as the backend took the ban, one entry per ban posted. */
const atThePost: number[] = [];

// The backend takes the ban, and nothing else: any other request fails the case. It reads the store as the write
// arrives, so a case sees whether the sessions were ended before the write stood.
const backend = serveBackend(({ method, path }) => {
  if (method !== "POST" || path !== "/ban_list") return undefined;
  atThePost.push(sessionsOfMax().length);
  return { created_id: "65a000000000000000000001" } satisfies FLPostBanListEntryResponse;
});
// The administrator, signed in by passkey just now, which the touch a ban sits behind takes.
const { store } = signedInRequest();

const { auth } = await import("@/core/auth/library");
const { enterBan } = await import("./banActs");

const sessionsOfMax = () => store.session.filter(({ userId }) => userId === MAX_ID);

/** Max's account in the sign-in store, signed in on `sessions` devices. */
function maxSignedInOn(sessions: number): void {
  const now = new Date();
  store.user.push({ id: MAX_ID, email: ADDRESS, emailVerified: true, name: "", createdAt: now, updatedAt: now });
  for (let device = 0; device < sessions; device += 1) {
    const id = `64d00000000000000000000${String(device)}`;
    store.session.push({
      id,
      token: `token-of-max-${String(device)}`,
      userId: MAX_ID,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    });
  }
}

/** Whether the store holds the stamp that ends every session of Max's account. */
const maxStamped = (): boolean => store.user.find(({ id }) => id === MAX_ID)?.sessionsEndedAt instanceof Date;

/**
 * The sign-in store failing, for the rest of the case, every `operation` on Max's account row, as a store gone away
 * fails it: the administrator's own session stays readable, so the guard admits as before.
 */
async function storeFailsOnMax(operation: "findOne" | "update"): Promise<void> {
  const { adapter } = await auth.$context;
  const real = adapter[operation].bind(adapter) as (query: { model: string; where?: { field: string; value: unknown }[] }) => Promise<unknown>;
  const failing = vi.spyOn(adapter, operation).mockImplementation((async (query: Parameters<typeof real>[0]) => {
    const onMax = query.model === "user" && (query.where ?? []).some(({ field, value }) => field === "email" && value === ADDRESS);
    if (onMax) throw new Error("the store is away");
    return real(query);
  }) as never);
  onTestFinished(() => {
    failing.mockRestore();
  });
}

const bansPosted = () => backend.sent.filter(({ method, path }) => method === "POST" && path === "/ban_list").map(({ body }) => body);

describe("a ban", () => {
  // No static check holds this: a ban that skipped it reads as done while the person stays signed in, for as long as
  // their session lasts.
  it("ends the address's sessions once the write stands, and says nothing more", async () => {
    atThePost.length = 0;
    maxSignedInOn(2);

    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined });

    expect(bansPosted()).toStrictEqual([{ email: ADDRESS, ban_reason: "Ein Grund", notify: true } satisfies FLPostBanListEntryPayload]);
    // Both sessions stood as the write arrived, and none after it.
    expect(atThePost).toStrictEqual([2]);
    expect(sessionsOfMax()).toStrictEqual([]);
    expect(maxStamped()).toBe(true);
  });

  it("owes no notice where no account stands, and that is no partial outcome", async () => {
    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined });

    expect(bansPosted()).toMatchObject([{ notify: false }]);
  });

  // The sign-out follows a write that cannot be taken back, so the dialog must say it did not follow.
  it("keeps its button for a second press and says what did not follow where the sign-out failed", async () => {
    maxSignedInOn(1);
    await storeFailsOnMax("update");

    expect(await enterBan(BAN)).toStrictEqual({ ok: false, reason: PARTIAL.sessions, warn: true });

    expect(bansPosted()).toMatchObject([{ email: ADDRESS, notify: true }]);
    expect(sessionsOfMax()).toHaveLength(1);
  });

  it("stands done and says so where the store did not say whether an account stands, which no press repairs", async () => {
    maxSignedInOn(1);
    await storeFailsOnMax("findOne");

    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined, note: PARTIAL.notice, warn: true });

    // Nobody is told on a guess, and the sessions still end.
    expect(bansPosted()).toMatchObject([{ notify: false }]);
    expect(sessionsOfMax()).toStrictEqual([]);
  });

  // A POST whose answer was lost leaves the ban standing and the sign-out never run, and nothing but this press ends it.
  describe("a second ban", () => {
    const answeredBanned = () => {
      backend.answerWith(({ method, path }) => (method === "POST" && path === "/ban_list" ? refusal("duplicate_key") : undefined));
    };

    // The harm: the dialog has closed before the answer, so a box's phrase would reach its toast as the pointer at
    // fields nobody sees.
    it("is refused in a sentence of its own where nothing was left to end", async () => {
      answeredBanned();
      maxSignedInOn(0);

      expect(await enterBan(BAN)).toStrictEqual({ ok: false, errorCode: "duplicate_key", reason: SERVER_COPY.closedDialog.banned });

      // The ending still ran, stamping the account.
      expect(maxStamped()).toBe(true);
    });

    // The harm: „Schon vergeben“ over a press that did what the warn line left open reads as nothing having happened.
    it("says the sessions the first left running ended, and refuses nothing", async () => {
      answeredBanned();
      maxSignedInOn(2);

      expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined, note: PARTIAL.ended });

      expect(sessionsOfMax()).toStrictEqual([]);
    });

    // The harm: a field error stands on the box until its value changes, so the browser holds back the press that still could.
    it("says so where they did not end and they run, and leaves the address free to press again", async () => {
      answeredBanned();
      maxSignedInOn(1);
      await storeFailsOnMax("update");

      expect(await enterBan(BAN)).toStrictEqual({ ok: false, reason: PARTIAL.sessions, warn: true });

      expect(sessionsOfMax()).toHaveLength(1);
    });
  });

  it.each([
    ["an address of the wrong shape", { email: "max@example" }, SERVER_COPY.closedDialog.format.address, undefined],
    ["a Grund of spaces", { ban_reason: "   " }, SERVER_COPY.closedDialog.reasonMissing, undefined],
    ["a Grund holding an address", { ban_reason: ADDRESS }, SERVER_COPY.closedDialog.reasonWithAddress, "address_in_free_text"],
  ])("refuses %s in its box's sentence, the dialog having closed", async (_case, typed, reason, rule) => {
    if (rule !== undefined) {
      backend.answerWith(({ method, path }) =>
        method === "POST" && path === "/ban_list"
          ? refusal("payload_refused", { fields: [{ path: ["ban_reason"], kind: rule, ctx: {}, in: "body" }] })
          : undefined,
      );
    }

    expect(await enterBan({ ...BAN, ...typed })).toMatchObject({ ok: false, reason });
    // A box the parse refuses posts nothing; the backend's own refusal is of the one ban posted.
    expect(bansPosted()).toHaveLength(rule === undefined ? 0 : 1);
  });

  // A write the backend refused stands nowhere, so there is nothing for a sign-out to follow.
  it("ends no session where the backend refuses the ban", async () => {
    backend.answerWith(({ method, path }) => (method === "POST" && path === "/ban_list" ? refusal("ban_list_admin") : undefined));
    maxSignedInOn(1);

    expect(await enterBan(BAN)).toMatchObject({ ok: false, reason: SERVER_COPY.refusalLine.ban_list_admin });

    expect(sessionsOfMax()).toHaveLength(1);
    expect(maxStamped()).toBe(false);
  });
});
