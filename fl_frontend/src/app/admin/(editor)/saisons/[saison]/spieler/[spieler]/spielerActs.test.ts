import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

const SPIELER_ID = "64b000000000000000000002";
const SAISON = "2027";

// Every other row of the squad gave the role away since the page offered the return: the backend refuses it on `rolle`,
// a box the return's press holds none of.
serveBackend(({ method, path }) =>
  method === "POST" && path === `/spieler/${SPIELER_ID}/saisons/${SAISON}/reactivate`
    ? refusal("kader_rolle_taken", { status: 409, fields: [{ kind: "kader_rolle_taken", path: ["rolle"], ctx: {}, in: "body" }] })
    : undefined,
);
// An administrator's session, made by passkey, which the act's guard admits.
signedInRequest();

const { reactivateSpieler } = await import("./spielerActs");

describe("a player's return", () => {
  // The harm: the stale-page line, whose reload offers the return locked and says nothing of the role it was refused for.
  it("says the role is taken where no box shows it", async () => {
    expect(await reactivateSpieler({ id: SPIELER_ID, saison: SAISON })).toStrictEqual({
      ok: false,
      errorCode: "kader_rolle_taken",
      reason: SERVER_COPY.refusalLine.kader_rolle_taken,
    });
  });
});
