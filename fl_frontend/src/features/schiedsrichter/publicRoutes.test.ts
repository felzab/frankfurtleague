import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { doubleLogger, loggedErrorCodes } from "@/shared/testing/actionDoubles.ts";
import { laufendeSchiedsrichterFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { answerReadsWith, backendUnreachable, EMPTIEST_ANSWER, pageBody } from "@/shared/testing/pageHarness.ts";

import type { ReactElement } from "react";
import type { SchiedsrichterBestaetigungStart } from "./components/views/SchiedsrichterBestaetigungView.tsx";

doubleLogger();

const { default: SchiedsrichterBestaetigungPage } = await import("@/app/(public)/bestaetigung/schiedsrichter/page.tsx");

const WORTE = laufendeSchiedsrichterFassung();

/** The link's own view, open. */
const GEOEFFNET = {
  acknowledged: 1,
  zustand: "gueltig",
  text_version: WORTE.textVersion,
  mindestalter: 16,
  medien_mindestalter: 18,
  frist: "2026-10-05",
} as const;

/**
 * The page's start as the backend's reads answer it, `laufend` being what it runs on this page, `seiten`
 * the registry's whole answer and `scheitert` failing the words read.
 */
async function start({
  laufend,
  seiten,
  scheitert = false,
}: { laufend?: string; seiten?: unknown; scheitert?: boolean } = {}): Promise<SchiedsrichterBestaetigungStart> {
  answerReadsWith((endpoint, schema, params) => {
    if (scheitert && endpoint.startsWith("/einwilligung/fassungen/")) throw new Error(`the backend failed ${endpoint}`);
    if (endpoint === "/einwilligung/seiten" && seiten !== undefined) return seiten;
    if (endpoint === "/einwilligung/seiten" && laufend !== undefined) {
      return { acknowledged: 1, laufende_fassungen: { bestaetigung_schiedsrichter: laufend } };
    }
    if (endpoint === "/schiedsrichter/bestaetigung/ansicht") return GEOEFFNET;
    return einwilligungAnswer(endpoint) ?? EMPTIEST_ANSWER(endpoint, schema, params);
  });
  const body = (await pageBody(SchiedsrichterBestaetigungPage, {
    params: Promise.resolve({}),
    searchParams: Promise.resolve({ token: "kein-echtes-token" }),
  })) as ReactElement<{ start: SchiedsrichterBestaetigungStart }>;

  return body.props.start;
}

describe("the words the referee's confirmation page is handed", () => {
  it("hands an open link the words the backend runs on this page", async () => {
    const offen = await start();

    assert.deepEqual(offen.zustand === "gueltig" ? offen.fassung : null, WORTE, "the page renders words other than the backend serves");
  });

  /* A label whose sections were never kept by key is a broken contract rather than a failed read: it
     reaches the error boundary, which logs it, never the panel asking for a reload. */
  it("lets a running label the page cannot place reach the error boundary", async () => {
    await assert.rejects(
      start({ laufend: "2026-09-schiedsrichterseite" }),
      { name: "ZodError" },
      "the page absorbed words it holds no keys for",
    );
  });

  /* The read failing is a state of its own, which a reload may clear. */
  it("opens a link on the failed read's panel where the words read fails", async () => {
    assert.deepEqual(await start({ scheitert: true }), { zustand: "unlesbar" });
    // Untyped, as a cached read's throw arrives: only this line tells it from a bug.
    assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"], "the failure went unlogged");
  });

  /* A registry answering against what this page was built for is no failed read: only a deploy repairs
     it, so it reaches the error boundary, which logs it, never the panel asking for a reload. */
  it("lets a registry breaking its contract reach the error boundary", async () => {
    await assert.rejects(
      start({ seiten: { acknowledged: 1, laufende_fassungen: {} } }),
      { name: "ContractBreakError" },
      "no label for the page",
    );
    await assert.rejects(start({ seiten: { acknowledged: 1 } }), { name: "APIMalformedDataError" }, "an answer off its schema");
  });

  /* The read refuses a view serving a media floor of 0, which would offer the media switch to every age:
     a broken contract, which the error boundary logs and the reload panel would hide. */
  it("lets a view serving a media floor of 0 reach the error boundary", async () => {
    answerReadsWith((endpoint, schema, params) =>
      endpoint === "/schiedsrichter/bestaetigung/ansicht"
        ? { ...GEOEFFNET, medien_mindestalter: 0 }
        : (einwilligungAnswer(endpoint) ?? EMPTIEST_ANSWER(endpoint, schema, params)),
    );

    await assert.rejects(
      pageBody(SchiedsrichterBestaetigungPage, { params: Promise.resolve({}), searchParams: Promise.resolve({ token: "kein-echtes-token" }) }),
      { name: "APIMalformedDataError" },
      "the page took a media floor of 0",
    );
  });

  for (const [wie, thrown, codes] of [
    ["went unanswered", () => backendUnreachable("/schiedsrichter/bestaetigung/ansicht", "POST"), []],
    // A bug in the read's narrowing: only this line tells it from a read that failed.
    ["threw untyped", () => new TypeError("Cannot read properties of undefined (reading 'zustand')"), ["FE-RSC-001"]],
  ] as const) {
    it(`opens a link on the failed read's panel where the link's own read ${wie}, logging ${codes.length === 0 ? "nothing" : "it"}`, async () => {
      answerReadsWith((endpoint, schema, params) => {
        if (endpoint === "/schiedsrichter/bestaetigung/ansicht") throw thrown();
        return einwilligungAnswer(endpoint) ?? EMPTIEST_ANSWER(endpoint, schema, params);
      });
      const body = (await pageBody(SchiedsrichterBestaetigungPage, {
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ token: "kein-echtes-token" }),
      })) as ReactElement<{ start: SchiedsrichterBestaetigungStart }>;

      assert.deepEqual(body.props.start, { zustand: "unlesbar" });
      assert.deepEqual(loggedErrorCodes(), codes);
    });
  }
});
