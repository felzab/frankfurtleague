// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { underNext } from "@/test-support/nextContexts.ts";
import { filesUnder } from "@/test-support/treeWalk.ts";
import { act, cleanup, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ComponentType } from "react";

const APP_DIR = import.meta.dirname;

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3);

type Boundary = ComponentType<{ error: Error & { digest?: string }; retry: () => void }>;

/** The requests one boundary sent while it drew a client crash, each as its address and its method. */
async function reportsOf(file: string): Promise<{ address: string; method: string | undefined }[]> {
  const sent = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
  const { default: Boundary } = (await import(pathToFileURL(file).href)) as { default: Boundary };

  try {
    render(underNext(h(Boundary, { error: new Error("gepflanzt"), retry: () => undefined })));
    // `render` has already flushed the effect sending the report; the turn after its answer charges a
    // second report sent meanwhile to this boundary's count, never to the next one's.
    await act(() => Promise.resolve());

    return sent.mock.calls.map(([input, init]) => ({ address: String(input), method: init?.method }));
  } finally {
    cleanup();
    sent.mockRestore();
  }
}

describe("the crash report every error boundary stands behind", () => {
  /* The failure this case exists for is silent by construction: a boundary reporting nothing
     leaves no line to miss, and the segments render no component in common to hold instead. */
  it("is sent from every boundary the app tree holds, to a route this app serves", async () => {
    for (const file of BOUNDARIES) {
      const shown = path.relative(APP_DIR, file).split(path.sep).join("/");
      const reports = await reportsOf(file);

      expect(reports.length, `${shown}: sends ${String(reports.length)} reports of one crash`).toBe(1);
      expect(reports[0]?.method, `${shown}: asks for its report rather than sending it`).toBe("POST");

      // The hook posting to a path Next serves nothing at answers 404, and the `catch` that keeps a
      // failed report from crashing the boundary again hides it.
      const route = path.join(APP_DIR, ...(reports[0]?.address ?? "").split("/"), "route.ts");
      expect(existsSync(route), `${shown}: reports to ${String(reports[0]?.address)}, where the app serves no route`).toBe(true);
    }
  });
});
