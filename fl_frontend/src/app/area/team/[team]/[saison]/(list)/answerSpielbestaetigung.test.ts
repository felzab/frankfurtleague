import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { seat } from "@/test-support/subjectFixtures";

const TEAM = "6890a1b2c3d4e5f607250011";
const ROW = "6890a1b2c3d4e5f607250031";

// The write refuses a proposal naming the slot the fixture already holds, on each of the two fields it nests under the
// proposal, as the backend's judge names them.
serveBackend(({ method, path }) =>
  method === "POST" && path === `/spielbestaetigungen/${ROW}/answer/team`
    ? refusal("ansetzung_vorschlag_unchanged", {
        status: 422,
        fields: [
          { kind: "ansetzung_vorschlag_unchanged", path: ["vorschlag", "date"], ctx: {}, in: "body" },
          { kind: "ansetzung_vorschlag_unchanged", path: ["vorschlag", "time"], ctx: {}, in: "body" },
        ],
      })
    : undefined,
);
signedInRequest({ email: "pia@example.org", records: { seats: [seat({ team_id: TEAM, saison_id: "2027" })] } });

const { declineSpielbestaetigung } = await import("./answerSpielbestaetigung");

describe("a club's decline proposing another slot", () => {
  // The harm: the dialog's two boxes unmarked, the person reading a sentence on the line and „Schon hinterlegt“ nowhere.
  it("stands each fault of the proposal on the dialog's box for it", async () => {
    const answer = await declineSpielbestaetigung({ id: ROW, date: "2027-03-14", time: "15:30:00", reason: "" });

    expect(answer).toStrictEqual({
      ok: false,
      errorCode: "ansetzung_vorschlag_unchanged",
      fieldErrors: { date: COPY.shared.field.onFile, time: COPY.shared.field.onFile },
      kinds: { date: "ansetzung_vorschlag_unchanged", time: "ansetzung_vorschlag_unchanged" },
    });
  });
});
