import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context, so a Next release that moves either module fails this
   file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { filesUnder } from "@/core/treeWalk.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9). */
const { default: AdminNotFound } = await import("./not-found.tsx");

const ADMIN_DIR = import.meta.dirname;

/** One file name, exactly: `not-found.test.tsx` is no boundary, and a suffix test would take it. */
const named = (wanted: string) => (name: string) => name === wanted;

const BOUNDARIES = filesUnder(ADMIN_DIR, named("not-found.tsx"), 1);
const PAGES = filesUnder(ADMIN_DIR, named("page.tsx"), 15);

/** What `Link` reads off `useRouter`. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

// Under a season, which is the state the boundary is served in: the way out is built from the query
// the 404 was answered for.
const PANEL = renderTree(
  h(
    AppRouterContext.Provider,
    { value: ROUTER },
    h(SearchParamsContext.Provider, { value: new URLSearchParams("saison_id=2526") }, h(AdminNotFound, {})),
  ),
);

const HREFS = [...PANEL.matchAll(/href="([^"]*)"/g)].map((treffer) => treffer[1]!);

describe("the 404 boundary an administrator meets", () => {
  /* First: a walk that stopped at the segment root would find the boundary, miss a nested one
     shadowing it, and report that as proof. */
  it("reaches the segments below the one it is walking", () => {
    assert.ok(
      PAGES.some((file) => path.dirname(file) !== ADMIN_DIR),
      "every page the walk found sits at the segment root, so it never descended",
    );
  });

  /* Next resolves `notFound()` to the nearest ancestor boundary, and a segment owns the layout that
     wraps its own: beside this `layout.tsx` the admin shell answers, one segment up the public one. */
  it("is the only boundary under /admin, in the segment the admin shell wraps", () => {
    assert.deepEqual(
      BOUNDARIES,
      [path.join(ADMIN_DIR, "not-found.tsx")],
      "an admin notFound() resolves to the nearest of these, and to the public 404 where none is left",
    );
    assert.ok(existsSync(path.join(ADMIN_DIR, "layout.tsx")), "no layout stands beside the boundary to wrap what it renders");
  });

  /* The public 404 offers the visitor's start page, so a way out pointing anywhere but `/admin`
     leaves an administrator to sign back in through the front door. */
  it("hands the reader back into the administration", () => {
    assert.ok(HREFS.length > 0, "the boundary renders no way out at all");
    assert.deepEqual(
      HREFS.filter((href) => !href.startsWith("/admin")),
      [],
      "these links leave the administration",
    );
  });

  /* A shell page carries the route's only `h1` (`.claude/rules/frontend.md`), which is what the
     panel's `inline` variant is for; the `page` variant the public 404 takes renders one. */
  it("leaves the h1 to the shell above it", () => {
    assert.doesNotMatch(PANEL, /<h1\b/, "the boundary renders a second h1 inside the admin shell");
    assert.match(PANEL, /<h2\b/, "the boundary renders no heading, so the case above passes over an empty panel");
  });
});
