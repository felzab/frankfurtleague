import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

import "@/shared/testing/renderTest.ts";

/** Where the doubled current-season read takes its answer from, one case at a time. */
const ANSWER = "__flCurrentSaisonAntwort";
/** Every season-list read the guard makes, which `.claude/rules/frontend.md` **saisons** forbids it. */
const LIST_READS = "__flSaisonListReads";

const SAISONS_QUERIES_DOUBLE = `export const getCurrentSaisonOrNull = async () => globalThis.${ANSWER};
export const getSaisons = async () => { globalThis.${LIST_READS}.push("getSaisons"); return { saisons: [] }; };
export const getAdminSaisons = async () => { globalThis.${LIST_READS}.push("getAdminSaisons"); return { saisons: [] }; };`;

/** Stands in for `next/server`, whose `connection()` is request-only and this process makes no request. */
const CONNECTION_DOUBLE = `export const connection = async () => undefined;`;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/next/server.js")) return { format: "module", source: CONNECTION_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/features/saisons/queries.ts")) return { format: "module", source: SAISONS_QUERIES_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const globals = globalThis as unknown as Record<string, unknown>;
const listReads: string[] = [];
globals[LIST_READS] = listReads;

/* Loaded rather than read: a redirect is what the layout throws, and no assertion over its source
   text can show which state throws it. */
const { default: CurrentSaisonLayout } = await import("./(current-saison)/layout.tsx");

const GROUP_DIR = path.join(import.meta.dirname, "(current-saison)");

/** The admin urls the group answers, off the tree: a route group adds no segment of its own. */
const GUARDED_URLS = filesUnder(GROUP_DIR, (name) => name === "page.tsx", 1)
  .map((file) => `/admin/${path.relative(GROUP_DIR, path.dirname(file)).split(path.sep).join("/")}`)
  .sort();

/** Where a thrown redirect sends the reader, read off the digest Next's `redirect()` stamps. */
const redirectTarget = (error: unknown): string | null => {
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;
};

const RUNNING = { acknowledged: 1, saison: { id: "2026", status: "active" } };

describe("the admin pages that need a running season", () => {
  /* The guard's reach: each page here passes an omitted season to a read the backend answers 404
     while none runs. A page moved out renders the error page again; one moved in is sent away. */
  it("are exactly the three whose reads default to the running season", () => {
    assert.deepEqual(GUARDED_URLS, ["/admin/action_required", "/admin/finalrunden", "/admin/spielsuche"]);
  });

  it("send the admin to the season list while no season runs", async () => {
    globals[ANSWER] = null;

    await assert.rejects(CurrentSaisonLayout({ children: "Seite" }), (error: unknown) => redirectTarget(error) === "/admin/saisons");
  });

  /* The control: a layout redirecting every time passes the case above. */
  it("render the page while a season runs", async () => {
    globals[ANSWER] = RUNNING;

    const rendered = (await CurrentSaisonLayout({ children: "Seite" })) as { props: { children: unknown } };

    assert.equal(rendered.props.children, "Seite");
  });

  /* `.claude/rules/frontend.md` **saisons**: the list is fetched only where `?saison_id=` names a
     season, and a layout on every one of these pages would fetch it on each visit. */
  it("read the running season and never the season list", async () => {
    listReads.length = 0;

    for (const answer of [null, RUNNING]) {
      globals[ANSWER] = answer;
      await CurrentSaisonLayout({ children: "Seite" }).catch(() => undefined);
    }

    assert.deepEqual(listReads, []);
  });
});
