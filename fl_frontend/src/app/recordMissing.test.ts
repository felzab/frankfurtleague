import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { serveServerReact } from "@/test-support/cacheScope.ts";
import { describe, expect, it } from "vitest";

import { APIBadStatusError } from "@/core/errors.ts";

import type { Code } from "@/core/generated/client/types.ts";

/** What the doubled client throws for every read, set by each case. */
let failure: unknown;
// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

doubleApiClient(() => {
  throw failure;
});

serveServerReact();

const bewerbungen = await import("@/features/bewerbungen/queries.ts");
const saisons = await import("@/features/saisons/queries.ts");
const schiedsrichter = await import("@/features/schiedsrichter/queries.ts");
const spiele = await import("@/features/spiele/queries.ts");
const spieltage = await import("@/features/spieltage/queries.ts");
const teams = await import("@/features/teams/queries.ts");

// A fresh id per call: React's `cache` would answer a repeated one from the first case's result.
let calls = 0;
const freshId = (): string => (calls += 1).toString(16).padStart(24, "0");

/** Every read answering "none" off the API's record-missing refusal, each turned into its caller's `null`. */
const READS: Readonly<Record<string, () => Promise<unknown>>> = {
  getBewerbungById: () => bewerbungen.getBewerbungById(freshId()),
  getOffenesBewerbungFenster: () => bewerbungen.getOffenesBewerbungFenster(),
  getBewerbungFenster: () => bewerbungen.getBewerbungFenster(freshId()),
  getActiveSaisonOrNull: () => saisons.getActiveSaisonOrNull(),
  getSchiedsrichterById: () => schiedsrichter.getSchiedsrichterById(freshId()),
  getAdminSpiel: () => spiele.getAdminSpiel(freshId()),
  getAdminSpieltagById: () => spieltage.getAdminSpieltagById(freshId()),
  getTeam: () => teams.getTeam(freshId()),
};

const notFound = (serverErrorCode: Code | undefined): APIBadStatusError =>
  new APIBadStatusError({
    message: "not found",
    url: "http://backend/api/v0/x",
    statusCode: 404,
    serverErrorCode,
    endpoint: "/x",
    method: "GET",
    readOnly: true,
    traceId: "0",
  });

describe("a read of a record the API says is missing", () => {
  it("answers the record-missing code as the caller's none", async () => {
    failure = notFound("document_not_found");

    for (const [name, read] of Object.entries(READS)) expect(await read(), name).toBe(null);
  });

  /* By the code and never the status: a 404 carrying none is a route the edge or the framework did not
     find, and reading it as none would render a page's missing state while the API is unreachable. */
  it("keeps a 404 carrying no code, or another code, the failure it is", async () => {
    for (const code of [undefined, "no_route"] as const) {
      const thrown = notFound(code);
      failure = thrown;

      for (const [name, read] of Object.entries(READS)) {
        await expect(read(), `${name} with ${String(code)}`).rejects.toSatisfy((error) => error === thrown);
      }
    }
  });
});
