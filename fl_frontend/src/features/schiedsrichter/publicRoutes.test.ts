import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { laufendeSchiedsrichterFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { answerReadsWith, EMPTIEST_ANSWER, pageBody } from "@/shared/testing/pageHarness.ts";

import type { ReactElement } from "react";
import type { SchiedsrichterBestaetigungStart } from "./components/views/SchiedsrichterBestaetigungView.tsx";

const { default: SchiedsrichterBestaetigungPage } = await import("@/app/(public)/bestaetigung/schiedsrichter/page.tsx");

const WORTE = laufendeSchiedsrichterFassung();

/** The link's own view, open. */
const GEOEFFNET = {
  acknowledged: 1,
  zustand: "gueltig",
  vorname: "Anna",
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
});
