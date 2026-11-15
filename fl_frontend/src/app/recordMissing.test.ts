import { refusal, serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { describe, expect, it } from "vitest";

import { APIBadStatusError } from "@/core/errors.ts";

import type { Code } from "@/core/generated/client/types.ts";

/** What the backend answers every read with, set by each case. */
let failure: () => Response;
const backend = serveBackend(() => failure());
// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
signedInRequest();

const bewerbungen = await import("@/features/bewerbungen/queries.ts");
const schiedsrichter = await import("@/features/schiedsrichter/queries.ts");
const spiele = await import("@/features/spiele/queries.ts");

const ONE_ID = "0123456789abcdef01234567";

/** Every read answering "none" off the API's record-missing refusal, each turned into its caller's `null`. */
const READS: Readonly<Record<string, () => Promise<unknown>>> = {
  getBewerbungById: () => bewerbungen.getBewerbungById(ONE_ID),
  getSchiedsrichterById: () => schiedsrichter.getSchiedsrichterById(ONE_ID),
  getAdminSpiel: () => spiele.getAdminSpiel(ONE_ID),
  getAdminSpielplan: () => spiele.getAdminSpielplan("2027"),
};

describe("a read of a record the API says is missing", () => {
  /* By the code and never the status: a 404 carrying none is a route the edge or the framework did not
     find, and reading it as none would render a page's missing state while the API is unreachable. */
  it("keeps a 404 carrying no code, or another code, the failure it is", async () => {
    for (const code of [undefined, "no_route"] as const satisfies readonly (Code | undefined)[]) {
      failure = () => refusal(code, { status: 404 });

      for (const [name, read] of Object.entries(READS)) {
        const sent = backend.sent.length;
        await expect(read(), `${name} with ${String(code)}`).rejects.toSatisfy(
          (error) => error instanceof APIBadStatusError && error.statusCode === 404 && error.serverErrorCode === code,
        );
        expect(backend.sent.length, `${name} never asked the backend, so no answer was read`).toBe(sent + 1);
      }
    }
  });
});
