import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { SIGN_IN_LANDING } from "@/core/signInLanding.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { answerReadsWith, callPage, EMPTIEST_ANSWER, isNavigation, OBJECT_ID, redirectTarget } from "@/shared/testing/pageHarness.ts";

import type { PageProps } from "@/shared/testing/pageHarness.ts";

/* Nobody signed in, and each page called without its layout: the router renders a page segment
   whatever the layout's guard decides, and a soft navigation renders no layout at all. */
doubleActionRequest({ session: null });

// The consent registry's own answers, so a base-tier read beside a page's first admin read settles as it would.
answerReadsWith((endpoint, schema, params) =>
  endpoint.startsWith("/einwilligung/") ? einwilligungAnswer(endpoint) : EMPTIEST_ANSWER(endpoint, schema, params),
);

const APP_DIR = import.meta.dirname;
const PAGES = filesUnder(APP_DIR, (name) => name === "page.tsx", 20);

/** The pages answering before any read, and why nothing there is shown to turn a visitor from. */
const ANSWERED_BEFORE_ANY_READ: Readonly<Record<string, string>> = {
  "[...unmatched]/page.tsx": "the admin 404, answered for an address no other route takes",
};

const label = (page: string) => path.relative(APP_DIR, page).split(path.sep).join("/");

/** One value per dynamic segment: a season id for a season's, an object id for every other. */
function paramsFor(page: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const segment of path.relative(APP_DIR, path.dirname(page)).split(path.sep)) {
    const dynamic = /^\[(\.\.\.)?(\w+)\]$/.exec(segment);
    if (dynamic === null) continue;
    const name = dynamic[2]!;
    params[name] = dynamic[1] !== undefined ? ["nirgendwo"] : name === "saison_id" ? "2026" : OBJECT_ID;
  }
  return params;
}

describe("every admin page called alone", () => {
  /* Each page on its own floor, so a page reading past the check, or swallowing its redirect in a
     `.catch`, fails by name rather than hiding behind the pages that redirected. */
  it("sends a session that is no administrator's to the sign-in landing, and crashes on none", async () => {
    const crashed: string[] = [];
    const sentElsewhere: string[] = [];
    const rendered: string[] = [];

    for (const page of PAGES) {
      const { default: Page } = (await import(pathToFileURL(page).href)) as { default: (props: PageProps) => unknown };
      const { thrown } = await callPage(Page, { params: Promise.resolve(paramsFor(page)), searchParams: Promise.resolve({}) });
      const targets = thrown.flatMap((error) => redirectTarget(error) ?? []);

      for (const error of thrown.filter((entry) => !isNavigation(entry))) {
        crashed.push(`${label(page)} :: ${error instanceof Error ? error.name : String(error)}`);
      }
      sentElsewhere.push(...targets.filter((target) => target !== SIGN_IN_LANDING).map((target) => `${label(page)} -> ${target}`));
      if (!targets.includes(SIGN_IN_LANDING) && ANSWERED_BEFORE_ANY_READ[label(page)] === undefined) rendered.push(label(page));
    }

    assert.deepEqual(crashed, [], "these pages crashed for a session that is no administrator's");
    assert.deepEqual(sentElsewhere, [], `a refused session goes to ${SIGN_IN_LANDING}, as the admin layout's guard sends it`);
    assert.deepEqual(rendered, [], "these pages rendered for a session that is no administrator's");
    assert.deepEqual(
      Object.keys(ANSWERED_BEFORE_ANY_READ).filter((excused) => !PAGES.map(label).includes(excused)),
      [],
      "these excuses name no page",
    );
  });
});
