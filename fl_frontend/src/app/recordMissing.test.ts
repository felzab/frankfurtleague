import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { SERVER_REACT_URL } from "@/core/cacheScope.ts";
import { APIBadStatusError } from "@/core/errors.ts";
import { REQUEST_PACKAGES } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/** The slice modules under test, whose `react` imports are the ones the server build must answer. */
const FEATURES_URL = pathToFileURL(`${import.meta.dirname}/../features/`).href;

/** What the doubled client throws for every read, set by each case. */
let failure: unknown;
doubleApiClient(() => {
  throw failure;
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && context.parentURL?.startsWith(FEATURES_URL)) return { url: SERVER_REACT_URL, shortCircuit: true };
    const double = REQUEST_PACKAGES[specifier];
    if (double !== undefined) return { url: `data:text/javascript,${encodeURIComponent(double)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

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
  getCurrentSaisonOrNull: () => saisons.getCurrentSaisonOrNull(),
  getSchiedsrichterById: () => schiedsrichter.getSchiedsrichterById(freshId()),
  getAdminSpiel: () => spiele.getAdminSpiel(freshId()),
  getAdminSpieltagById: () => spieltage.getAdminSpieltagById(freshId()),
  getTeam: () => teams.getTeam(freshId()),
};

const notFound = (serverErrorCode: string | undefined): APIBadStatusError =>
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
    failure = notFound("DB-COMMON-001");

    for (const [name, read] of Object.entries(READS)) assert.equal(await read(), null, name);
  });

  /* By the code and never the status: a 404 carrying none is a route the edge or the framework did not
     find, and reading it as none would render a page's missing state while the API is unreachable. */
  it("keeps a 404 carrying no code, or another code, the failure it is", async () => {
    for (const code of [undefined, "REQ-UNCLAIMED-000", "REQ-ROUTE-001"]) {
      const thrown = notFound(code);
      failure = thrown;

      for (const [name, read] of Object.entries(READS)) {
        await assert.rejects(read(), (error) => error === thrown, `${name} with ${String(code)}`);
      }
    }
  });
});
