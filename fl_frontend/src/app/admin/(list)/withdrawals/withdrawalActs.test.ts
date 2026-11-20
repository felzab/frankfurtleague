import { beforeEach, describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

import type { FLEinwilligungWithdrawalReport } from "@/core/generated/client/types";

/** The address the mail came from. */
const SENDER = "max@example.org";

const NOTHING: FLEinwilligungWithdrawalReport = {
  spieler: [],
  schiedsrichter: [],
  kontakt_seats: [],
  bewerbung_seats: [],
  registrierungen: [],
};

/** What the dry run answers for the case. */
const held = { report: NOTHING };

// The entry's dry run and its write, each answered only for the address the case enters.
const backend = serveBackend(({ method, path, search, body }) => {
  if (method !== "POST" || path !== "/identity/withdrawal" || (body as { email?: string }).email !== SENDER) return undefined;
  return search.get("dry_run") === "true" ? held.report : NOTHING;
});
const { store } = signedInRequest();

const { enterWithdrawal, readWithdrawal } = await import("./withdrawalActs");

/** The form as the page posts it: the address, and each ticked box under its own name with the value a box posts. */
function form(...ticked: readonly string[]): FormData {
  const posted = new FormData();
  posted.set("email", SENDER);
  for (const name of ticked) posted.set(name, "on");
  return posted;
}

beforeEach(() => {
  held.report = NOTHING;
});

describe("the withdrawal's question", () => {
  // The harm: a row per kind lists choices with „und“, which „Fotos und Videos“ holds too, so the list reads ambiguously.
  it("sends every ticked box to the dry run as its choice, and asks over each choice with the kinds it ends on", async () => {
    held.report = { ...NOTHING, spieler: ["name", "media"], kontakt_seats: ["whatsapp", "media"] };

    const answer = await readWithdrawal(form("name", "whatsapp", "media"));

    expect(backend.sent.map(({ method, path, search, body }) => ({ method, path, search: search.toString(), body }))).toStrictEqual([
      { method: "POST", path: "/identity/withdrawal", search: "dry_run=true", body: { email: SENDER, choices: ["name", "whatsapp", "media"] } },
    ]);
    expect(answer).toStrictEqual({
      ok: true,
      value: {
        question: {
          subject: ADMIN_COPY.withdrawal.object,
          consequence: ADMIN_COPY.withdrawal.consequence,
          facts: [
            { label: ADMIN_COPY.withdrawal.choice.name, value: ADMIN_COPY.withdrawal.ended([COPY.shared.spieler]) },
            { label: ADMIN_COPY.withdrawal.choice.whatsapp, value: ADMIN_COPY.withdrawal.ended([ADMIN_COPY.erasure.count.teamSeats]) },
            {
              label: ADMIN_COPY.withdrawal.choice.media,
              value: ADMIN_COPY.withdrawal.ended([COPY.shared.spieler, ADMIN_COPY.erasure.count.teamSeats]),
            },
          ],
        },
        input: { email: SENDER, choices: ["name", "whatsapp", "media"] },
      },
    });
  });

  it("refuses a form with no box ticked before anything is read", async () => {
    expect(await readWithdrawal(form())).toStrictEqual({ ok: false, reason: ADMIN_COPY.withdrawal.noneChosen });

    await backend.answered();
    expect(backend.sent).toStrictEqual([]);
  });

  // The harm: a question over nothing, whose press then records nothing and says it entered a withdrawal.
  it("refuses an address on which nothing ticked is granted", async () => {
    expect(await readWithdrawal(form("media"))).toStrictEqual({ ok: false, reason: ADMIN_COPY.withdrawal.nothingGranted });
  });
});

describe("the withdrawal's entry", () => {
  it("runs on a session whose passkey touch is not fresh, a withdrawal being on no touch's list", async () => {
    // The administrator's passkey sign-in of two minutes ago: past the touch, well inside the administrator's window.
    const [session] = store.session;
    if (session === undefined) throw new Error("the administrator's arrival wrote no session");
    session.createdAt = new Date(Date.now() - 2 * 60 * 1000);

    expect(await enterWithdrawal({ email: SENDER, choices: ["name"] })).toStrictEqual({
      ok: true,
      value: undefined,
      note: ADMIN_COPY.withdrawal.entered,
    });
    expect(backend.sent.map(({ method, path, search, body }) => ({ method, path, search: search.toString(), body }))).toStrictEqual([
      { method: "POST", path: "/identity/withdrawal", search: "", body: { email: SENDER, choices: ["name"] } },
    ]);
  });
});
