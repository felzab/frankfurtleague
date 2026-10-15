import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { SIGN_IN_LANDING } from "@/core/signInLanding.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import {
  answerReadsWith,
  callPage,
  clearSteps,
  EMPTIEST_ANSWER,
  isNavigation,
  OBJECT_ID,
  redirectTarget,
  steps,
} from "@/shared/testing/pageHarness.ts";

import type { PageStep } from "@/shared/testing/pageHarness.ts";

/* Nobody signed in, and each module called without the layouts above it: the router renders a page
   segment whatever a layout's guard decides, and a soft navigation renders no layout at all. */
doubleActionRequest({ session: null });

// The consent registry's own answers, so a base-tier read beside a page's first admin read settles as it would.
answerReadsWith((endpoint, schema, params) =>
  endpoint.startsWith("/einwilligung/") ? einwilligungAnswer(endpoint) : EMPTIEST_ANSWER(endpoint, schema, params),
);

const APP_DIR = import.meta.dirname;
// Every extension Next takes a segment module in.
const SEGMENT_FILE = (stem: string) => new RegExp(`^${stem}\\.[jt]sx?$`);
const PAGES = filesUnder(APP_DIR, (name) => SEGMENT_FILE("page").test(name), 20);
/* The other modules the router renders for a segment, any of which could read; the admin layout among
   them, so the floor is one. */
const SEGMENTS = filesUnder(APP_DIR, (name) => ["layout", "template", "default"].some((stem) => SEGMENT_FILE(stem).test(name)), 1);

/** The pages answering before any read, and why nothing there is shown to turn a visitor from. */
const ANSWERED_BEFORE_ANY_READ: Readonly<Record<string, string>> = {
  "[...unmatched]/page.tsx": "the admin 404, answered for an address no other route takes",
};

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

const label = (file: string) => path.relative(APP_DIR, file).split(path.sep).join("/");

/** One value per dynamic segment: a season id for a season's, a path for a catch-all, an object id for every other. */
function paramsFor(file: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const segment of path.relative(APP_DIR, path.dirname(file)).split(path.sep)) {
    // `[x]`, `[...x]`, and the optional `[[...x]]`.
    const dynamic = /^\[(\[)?(\.\.\.)?(\w+)\]\]?$/.exec(segment);
    if (dynamic === null) continue;
    const name = dynamic[3]!;
    params[name] = dynamic[2] !== undefined ? ["nirgendwo"] : name === "saison_id" ? "2026" : OBJECT_ID;
  }
  return params;
}

/** What calling one module and its metadata did: every throw, the redirects among them, and the reads it sent. */
type Visit = { thrown: unknown[]; targets: string[]; reads: Extract<PageStep, { kind: "read" }>[] };

type SegmentModule = {
  default: (props: Record<string, unknown>) => unknown;
  generateMetadata?: (props: Record<string, unknown>, parent: Promise<unknown>) => Promise<unknown>;
};

async function visit(file: string, isPage: boolean): Promise<Visit> {
  const segment = (await import(pathToFileURL(file).href)) as SegmentModule;
  const params = Promise.resolve(paramsFor(file));
  // A page is handed its query, every other module the segment below it.
  const props = isPage ? { params, searchParams: Promise.resolve({}) } : { params, children: h("p", null, "Seite") };

  clearSteps();
  const { thrown } = await callPage(segment.default, props);
  if (typeof segment.generateMetadata === "function") {
    try {
      await segment.generateMetadata(props, Promise.resolve({}));
    } catch (error) {
      thrown.push(error);
    }
  }

  return {
    thrown,
    targets: thrown.flatMap((error) => redirectTarget(error) ?? []),
    reads: steps.flatMap((step) => (step.kind === "read" ? [step] : [])),
  };
}

const VISITS = new Map<string, Visit & { isPage: boolean }>();
for (const page of PAGES) VISITS.set(label(page), { ...(await visit(page, true)), isPage: true });
for (const segment of SEGMENTS) VISITS.set(label(segment), { ...(await visit(segment, false)), isPage: false });
describe("every admin segment module called alone, for a session that is no administrator's", () => {
  it("crashes on none, and sends that session nowhere but the sign-in landing", () => {
    const crashed = [...VISITS].flatMap(([file, { thrown }]) =>
      thrown.filter((error) => !isNavigation(error)).map((error) => `${file} :: ${error instanceof Error ? error.name : String(error)}`),
    );
    const elsewhere = [...VISITS].flatMap(([file, { targets }]) =>
      targets.filter((target) => target !== SIGN_IN_LANDING).map((target) => `${file} -> ${target}`),
    );

    assert.deepEqual(crashed, [], "these modules crashed");
    assert.deepEqual(elsewhere, [], `a refused session goes to ${SIGN_IN_LANDING}, as the admin layout's guard sends it`);
  });

  /* The client a page reaches is doubled, so its own refusal of an admin-tier call naming nobody never
     runs here: an admin call made past `runAdminRead` would be sent, and is caught by its tier. */
  it("sends no admin-tier read", () => {
    const sent = [...VISITS].flatMap(([file, { reads }]) =>
      reads.filter(({ authType }) => authType === "admin").map(({ endpoint }) => `${file} :: ${endpoint}`),
    );

    assert.deepEqual(sent, []);
  });

  /* Each page on its own floor: one that renders without reaching an admin read, none made or every
     one's redirect swallowed, fails by name rather than hiding behind the pages that redirected. */
  it("turns that session away from every page reaching an admin read, which is every page but the excused", () => {
    const rendered = [...VISITS]
      .filter(([file, { isPage, targets }]) => isPage && !targets.includes(SIGN_IN_LANDING) && ANSWERED_BEFORE_ANY_READ[file] === undefined)
      .map(([file]) => file);

    assert.deepEqual(rendered, [], "these pages rendered for a session that is no administrator's");
  });

  /* An excuse holds only while its page answers its 404 and nothing else, having read nothing. */
  it("excuses only pages that answer their 404 before any read", () => {
    const answered = Object.keys(ANSWERED_BEFORE_ANY_READ).map((file) => {
      const found = VISITS.get(file);
      return {
        file,
        digests: found?.thrown.map((error) => (error as { digest?: unknown } | null)?.digest) ?? "no such page",
        reads: found?.reads.map(({ endpoint }) => endpoint) ?? [],
      };
    });

    assert.deepEqual(
      answered,
      Object.keys(ANSWERED_BEFORE_ANY_READ).map((file) => ({ file, digests: [NOT_FOUND], reads: [] })),
    );
  });
});
