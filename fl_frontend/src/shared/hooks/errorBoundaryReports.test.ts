import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { cleanup, render, waitFor } from "@testing-library/react";

import { filesUnder } from "@/core/treeWalk.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { ComponentType } from "react";

const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");

const fetchDouble = doubleFetch();

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3);

type Boundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

/** The requests one boundary sent while it drew a client crash, each as its address and its method. */
async function reportsOf(file: string, shown: string): Promise<{ address: string; method: string | undefined }[]> {
  fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
  const { default: Boundary } = (await import(pathToFileURL(file).href)) as { default: Boundary };

  const before = fetchDouble.mock.calls.length;
  render(underNext(h(Boundary, { error: new Error("gepflanzt"), reset: () => undefined })));
  try {
    // The report is sent from an effect, after the boundary has drawn.
    await waitFor(() =>
      assert.ok(
        fetchDouble.mock.calls.length > before,
        `${shown}: renders a segment's crash and reports none of it, so the crash reaches the browser's console and nothing else`,
      ),
    );
  } finally {
    cleanup();
  }

  return fetchDouble.mock.calls.slice(before).map(({ arguments: [input, init] }) => ({ address: String(input), method: init?.method }));
}

describe("the crash report every error boundary stands behind", () => {
  /* The failure this case exists for is silent by construction: a boundary reporting nothing
     leaves no line to miss, and the segments render no component in common to hold instead. */
  it("is sent from every boundary the app tree holds, to a route this app serves", async () => {
    for (const file of BOUNDARIES) {
      const shown = path.relative(APP_DIR, file).split(path.sep).join("/");
      const reports = await reportsOf(file, shown);

      assert.equal(reports.length, 1, `${shown}: sends ${String(reports.length)} reports of one crash`);
      assert.equal(reports[0]!.method, "POST", `${shown}: asks for its report rather than sending it`);

      // The hook posting to a path Next serves nothing at answers 404, and the `catch` that keeps a
      // failed report from crashing the boundary again hides it.
      const route = path.join(APP_DIR, ...reports[0]!.address.split("/"), "route.ts");
      assert.ok(existsSync(route), `${shown}: reports to ${reports[0]!.address}, where the app serves no route`);
    }
  });
});
