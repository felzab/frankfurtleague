import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import type { Code } from "@/core/generated/client/types";

/** The address the page was drawn for, which every act behind the passkey touch posts: the signed-in administrator's. */
const HOLDER = ADMIN_EMAIL;
const GRANT_ID = "64b000000000000000000002";
const ADDED = "max@example.org";

/** The backend's refusal of `code`, naming the address's box where `boxed`, as `find_exists_refusal` does. */
const refusing = (code: Code, boxed: boolean) => refusal(code, { fields: boxed ? [{ path: ["email"], kind: code, ctx: {}, in: "body" }] : [] });

// Each dialog's one write is refused as the case names; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path, body }) => {
  if (method === "POST" && path === "/grants" && (body as { email?: string } | undefined)?.email === ADDED) {
    return refusing("grant_exists", true);
  }
  if (method === "POST" && path === `/grants/${GRANT_ID}/handover`) return refusing("grant_barred", false);
  return undefined;
});
// An administrator's session, made by passkey just now, which both acts' guard and passkey touch admit.
signedInRequest();

const { addAdministrator, startHandover } = await import("./actions");

// The harm: both dialogs close before the passkey touch, so their answer is a toast, where a box's phrase or the line
// pointing at the fields names nothing in sight.
describe("the administrators' dialogs", () => {
  it("refuse an address a grant holds in a sentence naming it", async () => {
    expect(await addAdministrator({ email: ADDED, holder: HOLDER })).toStrictEqual({
      ok: false,
      errorCode: "grant_exists",
      reason: SERVER_COPY.refusalLine.grant_exists,
    });
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual(["POST /grants"]);
  });

  it("refuse an address of the wrong shape in the box's sentence, before anything is sent", async () => {
    expect(await addAdministrator({ email: "max@example", holder: HOLDER })).toStrictEqual({
      ok: false,
      reason: SERVER_COPY.closedDialog.format.address,
    });
    expect(backend.sent).toHaveLength(0);
  });

  it("refuse a handover to a banned address in its sentence", async () => {
    expect(await startHandover({ grant_id: GRANT_ID, holder: HOLDER })).toStrictEqual({
      ok: false,
      errorCode: "grant_barred",
      reason: SERVER_COPY.refusalLine.grant_barred,
    });
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual([`POST /grants/${GRANT_ID}/handover`]);
  });
});
