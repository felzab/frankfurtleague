import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { UnreadGrantError } from "@/core/errors.ts";
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

/* Nobody signed in, and each module called without the layouts above it: no layout turns a session away
   (`docs/frontend/spec.md :: I834`), and a soft navigation renders no layout at all. */
const { setRefusal } = doubleActionRequest({ session: null });

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
    assert.deepEqual(elsewhere, [], `a refused session goes to ${SIGN_IN_LANDING}, as every admin read sends it`);
  });

  /* The client a page reaches is doubled, so its own refusal of an admin-tier call naming nobody never
     runs here: an admin call made past `runAdminRead` would be sent, and is caught by its tier. */
  it("sends no admin-tier read", () => {
    const sent = [...VISITS].flatMap(([file, { reads }]) =>
      reads.filter(({ authType }) => authType === "admin").map(({ endpoint }) => `${file} :: ${endpoint}`),
    );

    assert.deepEqual(sent, []);
  });

  /* The only turn-away, no layout turning anyone away (`docs/frontend/spec.md :: I834`): each page on its own
     floor, so one whose admin read is missing or swallowed fails by name. */
  it("turns that session away from every page", () => {
    const rendered = [...VISITS].filter(([, { isPage, targets }]) => isPage && !targets.includes(SIGN_IN_LANDING)).map(([file]) => file);

    assert.deepEqual(rendered, [], "these pages rendered for a session that is no administrator's");
  });
});

const UNREAD = "UnreadGrantError";

/** A throw as the case compares it: Next's digest for a navigation, the class's name for the unread grant. */
function answerOf(error: unknown): string {
  if (error instanceof UnreadGrantError) return UNREAD;
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" ? digest : error instanceof Error ? error.name : String(error);
}

describe("every admin segment module called alone, for a grant the backend left unread", () => {
  /* One outage, one answer, the admin layout's hold and every page's read alike: thrown to the admin
     boundary, whose retry keeps the administrator in place, where a sign-in meets the same unread grant. */
  it("throws it to the admin boundary from the layout and every page, redirecting none", async () => {
    setRefusal("unread");
    const answers = new Map<string, { answered: string[]; isPage: boolean }>();
    for (const page of PAGES) answers.set(label(page), { answered: (await visit(page, true)).thrown.map(answerOf), isPage: true });
    for (const segment of SEGMENTS)
      answers.set(label(segment), { answered: (await visit(segment, false)).thrown.map(answerOf), isPage: false });

    const otherwise = [...answers].flatMap(([file, { answered }]) =>
      answered.filter((answer) => answer !== UNREAD).map((answer) => `${file} :: ${answer}`),
    );
    // Pages alone, as the refused session's floor: a template or a slot's default may read nothing at all.
    const unanswered = [...answers].filter(([, { answered, isPage }]) => isPage && !answered.includes(UNREAD)).map(([file]) => file);

    assert.deepEqual(otherwise, [], "these modules answered an unread grant otherwise");
    assert.deepEqual(unanswered, [], "these modules rendered for an unread grant");
    assert.ok(answers.get("layout.tsx")?.answered.includes(UNREAD), "the admin layout did not throw it, or was not visited");
  });
});
