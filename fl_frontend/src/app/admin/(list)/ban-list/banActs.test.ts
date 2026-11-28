import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

import type { FLCreatedResponse, FLPostBanListEntryPayload, FLRefusedField } from "@/core/generated/client/types";

const ADDRESS = "max@example.org";
const BAN = { email: ADDRESS, ban_reason: "Ein Grund", holder: ADMIN_EMAIL };
/** The shared failure line, „Etwas ist schiefgelaufen“, which every failure after the write shows. */
const FAILED = { ok: false, reason: COPY.shared.failure.unexpected };
const MAX_ID = "64c000000000000000000005";

/** The sessions of the banned address's account the store held as the backend took the ban, one entry per ban posted. */
const atThePost: number[] = [];

// The backend takes the ban and its dry run, and nothing else: any other request fails the case. It reads the store as
// the write arrives, so a case sees whether the sessions were ended before the write stood.
const backend = serveBackend(({ method, path, search }) => {
  if (method !== "POST" || path !== "/ban_list") return undefined;
  if (search.get("dry_run") === "true") return new Response(null, { status: 204 });
  atThePost.push(sessionsOfMax().length);
  return { created_id: "65a000000000000000000001" } satisfies FLCreatedResponse;
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

/** The bans posted, as the write when `dry` is false and as its dry run when it is true. */
const bansPosted = (dry = false) =>
  backend.sent
    .filter(({ method, path, search }) => method === "POST" && path === "/ban_list" && (search.get("dry_run") === "true") === dry)
    .map(({ body }) => body);

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

  it("owes no notice where no account stands, and stands done", async () => {
    expect(await enterBan(BAN)).toStrictEqual({ ok: true, value: undefined });

    expect(bansPosted()).toMatchObject([{ notify: false }]);
  });

  // The sign-out follows a write that cannot be taken back, so a failure there must not read as done.
  it("answers the shared failure line over a ban that stands where the sign-out failed", async () => {
    maxSignedInOn(1);
    await storeFailsOnMax("update");

    expect(await enterBan(BAN)).toStrictEqual(FAILED);

    expect(bansPosted()).toMatchObject([{ email: ADDRESS, notify: true }]);
    expect(sessionsOfMax()).toHaveLength(1);
  });

  // The harm: a ban written on a guess of whether an account stands would leave its holder untold of it, for good.
  it("writes nothing where the store did not say whether an account stands", async () => {
    maxSignedInOn(1);
    await storeFailsOnMax("findOne");

    expect(await enterBan(BAN)).toStrictEqual(FAILED);

    expect(bansPosted()).toStrictEqual([]);
    expect(sessionsOfMax()).toHaveLength(1);
  });

  // A POST whose answer was lost leaves the ban standing and the sign-out never run, and nothing but this press ends it.
  describe("a second ban", () => {
    const answeredBanned = () => {
      const listed: FLRefusedField = { kind: "address_barred", path: ["email"], ctx: {}, in: "body" };
      backend.answerWith(({ method, path }) =>
        method === "POST" && path === "/ban_list" ? refusal("address_barred", { fields: [listed] }) : undefined,
      );
    };
    const ON_ITS_BOX = {
      ok: false,
      errorCode: "address_barred",
      fieldErrors: { email: COPY.shared.field.barred },
      kinds: { email: "address_barred" },
    };

    // The harm: a refusal answered on the dialog's line rather than on the address's box, which nothing then marks.
    it("is refused on the address's box where nothing was left to end", async () => {
      answeredBanned();
      maxSignedInOn(0);

      expect(await enterBan(BAN)).toStrictEqual(ON_ITS_BOX);

      // The ending still ran, stamping the account.
      expect(maxStamped()).toBe(true);
    });

    // The harm: the dry run refuses a second ban before any touch, so a press of the write never comes, and the
    // sessions a lost answer left running would run on.
    it("ends the sessions at its dry run's refusal too", async () => {
      answeredBanned();
      maxSignedInOn(1);

      expect(await enterBan(BAN, true)).toStrictEqual(ON_ITS_BOX);

      expect(sessionsOfMax()).toStrictEqual([]);
      expect(maxStamped()).toBe(true);
    });

    // The harm: a field error stands on the box until its value changes, so the browser holds back the press that still could.
    it("answers the shared failure line where they did not end and they run, and leaves the address free to press again", async () => {
      answeredBanned();
      maxSignedInOn(1);
      await storeFailsOnMax("update");

      expect(await enterBan(BAN)).toStrictEqual(FAILED);

      expect(sessionsOfMax()).toHaveLength(1);
    });
  });

  // The harm: the dry run stands before any touch, so an effect of the write's own run there would act untouched.
  it("asks no account and ends no session on its dry run, which posts the ban as a dry run alone", async () => {
    maxSignedInOn(1);
    await storeFailsOnMax("findOne");

    expect(await enterBan(BAN, true)).toStrictEqual({ ok: true, value: undefined });

    expect(bansPosted(true)).toStrictEqual([{ email: ADDRESS, ban_reason: "Ein Grund", notify: false }]);
    expect(bansPosted()).toStrictEqual([]);
    expect(sessionsOfMax()).toHaveLength(1);
  });

  // A write the backend refused stands nowhere, so there is nothing for a sign-out to follow.
  it("ends no session where the backend refuses the ban", async () => {
    const held: FLRefusedField = { kind: "ban_list_admin", path: ["email"], ctx: {}, in: "body" };
    backend.answerWith(({ method, path }) =>
      method === "POST" && path === "/ban_list" ? refusal("ban_list_admin", { fields: [held] }) : undefined,
    );
    maxSignedInOn(1);

    expect(await enterBan(BAN)).toMatchObject({ ok: false, fieldErrors: { email: COPY.shared.field.ofAdministration } });

    expect(sessionsOfMax()).toHaveLength(1);
    expect(maxStamped()).toBe(false);
  });
});
