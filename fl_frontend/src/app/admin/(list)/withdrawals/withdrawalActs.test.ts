import { beforeEach, describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";
import { refusal, serveBackend } from "@/test-support/backend";
import { posted } from "@/test-support/posted";
import { signedInRequest } from "@/test-support/session";

import type { Code, FLEinwilligungWithdrawalReport } from "@/core/generated/client/types";

/** The address the mail came from. */
const SENDER = "max@example.org";

const NOTHING: FLEinwilligungWithdrawalReport = {
  spieler: [],
  schiedsrichter: [],
  kontakt_seats: [],
  bewerbung_seats: [],
  registrierungen: [],
};

/** What the dry run answers for the case: its report, or the refusal of the address. */
const held: { report: FLEinwilligungWithdrawalReport; refused: Code | undefined } = { report: NOTHING, refused: undefined };

// The entry's dry run and its write, each answered only for the address the case enters.
const backend = serveBackend(({ method, path, search, body }) => {
  if (method !== "POST" || path !== "/identity/withdrawal" || (body as { email?: string }).email !== SENDER) return undefined;
  if (held.refused !== undefined) return refusal(held.refused);
  return search.get("dry_run") === "true" ? held.report : NOTHING;
});
signedInRequest();

const { enterWithdrawal, readWithdrawal } = await import("./withdrawalActs");

/** The form as the page posts it: the address, and each ticked box under its own name with the value a box posts. */
function form(...ticked: readonly string[]): FormData {
  return posted({ email: SENDER, ...Object.fromEntries(ticked.map((name) => [name, "on"])) });
}

beforeEach(() => {
  held.report = NOTHING;
  held.refused = undefined;
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
    expect(await readWithdrawal(form())).toStrictEqual({ ok: false, reason: SERVER_COPY.actAnswer.withdrawal.noneChosen });

    await backend.answered();
    expect(backend.sent).toStrictEqual([]);
  });

  // The harm: a question over nothing, whose press then records nothing and says it entered a withdrawal.
  it("refuses an address on which nothing ticked is granted", async () => {
    expect(await readWithdrawal(form("media"))).toStrictEqual({ ok: false, reason: SERVER_COPY.actAnswer.withdrawal.nothingGranted });
  });

  // The harm: read as the shared failure line, the refusal names no reason and sends the administrator to a retry the
  // same rule refuses again.
  it.each(["own_address", "admin_address"] as const)("answers the backend's refusal of %s in its own words", async (code) => {
    held.refused = code;

    expect(await readWithdrawal(form("name"))).toMatchObject({ ok: false, reason: SERVER_COPY.refusalLine[code] });
  });
});

describe("the withdrawal's entry", () => {
  it("posts the entry once, with no dry run, and answers done", async () => {
    expect(await enterWithdrawal({ email: SENDER, choices: ["name"] })).toStrictEqual({ ok: true, value: undefined });
    expect(backend.sent.map(({ method, path, search, body }) => ({ method, path, search: search.toString(), body }))).toStrictEqual([
      { method: "POST", path: "/identity/withdrawal", search: "", body: { email: SENDER, choices: ["name"] } },
    ]);
  });
});
