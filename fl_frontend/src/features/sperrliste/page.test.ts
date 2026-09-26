import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, OBJECT_ID, renderPage } from "@/shared/testing/pageHarness.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { ReactElement } from "react";

doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: AdminSperrlistePage } = await import("@/app/bereich/admin/sperrliste/page.tsx");
const { AdminCrudShell } = await import("@/shared/components/ui/AdminCrudShell.tsx");

/** The one ban the list read answers, every other read the emptiest body its schema takes. */
const EINTRAG = {
  id: OBJECT_ID,
  grund: "Fremde Namen eingetragen",
  erstellt_von: "vorstand@example.org",
  erstellt_am: "2026-03-01",
  gesperrt_bis_saison_id: "2030",
};
answerReadsWith((endpoint, schema, params) =>
  endpoint === "/sperrliste"
    ? answer(schema, endpoint, { sperrliste: [EINTRAG], anzahl_gesamt: 1 })
    : EMPTIEST_ANSWER(endpoint, schema, params),
);

/** The page at its own address. */
const PAGE = underNext(h(AdminSperrlistePage, {}), { pathname: "/bereich/admin/sperrliste" });

describe("the page the ban list stands on", () => {
  /* One `h1` per page and the admin shell owns it (`.claude/rules/frontend.md`), so what this page
     may raise is none. */
  it("raises no heading the shell already owns", async () => {
    const markup = await renderPage(PAGE);

    // The control: a page rendering no row at all would satisfy the absence below unread.
    assert.ok(markup.includes(EINTRAG.grund), "the list renders no ban, so the absence below proves nothing");
    assert.ok(!markup.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  /* The bar an administrator types into is the one control this page offers, and the query it takes
     is a person's address: on this route alone it is held in the page rather than written to `?q=`. */
  it("asks the shell to hold the typed query instead of writing it", () => {
    const shell = AdminSperrlistePage() as ReactElement<{ privateQuery?: boolean }>;

    // What the flag does is `fl_frontend/src/shared/components/ui/AdminCrudPrivateQuery.test.ts`'s to hold.
    assert.equal(shell.type, AdminCrudShell, "the page's chrome is no longer the shell the flag is read by");
    assert.equal(shell.props.privateQuery, true, "the bar writes the typed address into a request line nginx logs");
  });

  /* The page's chrome may never wait on the list: rendered with no boundary awaited, the bar stands
     beside the list's fallback, where an async page would suspend whole. */
  it("renders its chrome before the list resolves", () => {
    const markup = renderTree(PAGE);

    assert.ok(markup.includes('role="status"'), "no fallback stands where the list will resolve");
    assert.ok(markup.includes('type="search"'), "the page's bar waits on the list");
  });
});
