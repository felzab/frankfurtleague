import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `useUrlFilters` reads the first and `useSearchParams` the
   second — and the view renders under both. A Next release that moves either module fails this file at
   import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { AdminAktionRow } from "../../types.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminAktionenView } = await import("./AdminAktionenView.tsx");
const { Callout } = await import("@/shared/components/ui/Callout.tsx");

type ViewProps = Parameters<typeof AdminAktionenView>[0];

/** One recorded write, so every notice below is read off a page that also drew a row. */
const ROW: AdminAktionRow = {
  id: "68c1f0a2b3c4d5e6f7a8b9c0",
  at: "2026-08-20T14:23:05+00:00",
  actor: { kind: "admin_session", email: "eine.person@beispiel.de" },
  trace_id: "8f14e45fceea167a",
  request: { method: "PATCH", path: "/api/v1/teams/68c1f0a2b3c4d5e6f7a8b9c0" },
  collection: "teams",
  operation: "patch_one",
  document_id: "68c1f0a2b3c4d5e6f7a8b9c0",
  db_filter: null,
  modified_count: null,
  redacted_at: null,
  stand_gesichert: true,
};

/** The whole log, served complete and narrowed to nothing. Each case names the one prop it is about. */
const GANZES_PROTOKOLL: ViewProps = {
  aktionen: [ROW],
  vollstaendig: true,
  anzahlJeCollection: { teams: 1 },
  anzahlJeOperation: { patch_one: 1 },
  anzahlJeHerkunft: { person: 1 },
  dokumentId: null,
  vorgangId: null,
  richtung: "desc",
};

/** What `useRouter` hands the bar's own controls. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/**
 * The two contexts the view reads and no prop carries: the router the bar narrows through, and the
 * query the way out of a narrowing rides.
 */
const view = (props: Partial<ViewProps> = {}, query = "saison_id=2526"): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, h(AdminAktionenView, { ...GANZES_PROTOKOLL, ...props })),
    ),
  );

/** Each notice's own heading, which is how one of three in a single markup is found. */
const TITEL = {
  dokument: "Nur ein Datensatz",
  vorgang: "Nur ein Vorgang",
  gekappt: "Das Protokoll ist unvollständig",
} as const;

/**
 * One notice, as the class its heading carries and the markup under it. `Callout` puts the severity on
 * that heading, so one of three notices is found and graded in a single match.
 */
function notice(html: string, title: string): { headingClass: string; body: string } {
  const found = new RegExp(`<strong class="([^"]*)">${title}</strong>\\s*<p class="[^"]*">([\\s\\S]*?)</p>`).exec(html);
  assert.notEqual(found, null, `the view renders no notice headed: ${title}`);

  return { headingClass: found?.[1] ?? "", body: found?.[2] ?? "" };
}

/** The sentences a reader hears, with the markup taken out and the JSX line breaks collapsed. */
const noticeText = (html: string, title: string): string => textOf(notice(html, title).body).replace(/\s+/g, " ").trim();

/** `Callout`'s own heading at one severity, so the comparison is against the recipe and not a literal. */
const headingAt = (severity: "info" | "warning"): string =>
  /<strong class="([^"]*)">/.exec(renderMarkup(Callout, { severity: severity, title: "x" }))?.[1] ?? "";

/** The one anchor of a notice, as its target and the words it is announced by. */
function anchor(body: string): { href: string; name: string } {
  const found = /<a ([^>]*)>(.*?)<\/a>/s.exec(body);
  assert.notEqual(found, null, "the notice offers no way out of the narrowing");
  const attrs = found?.[1] ?? "";

  return { href: /href="([^"]*)"/.exec(attrs)?.[1]?.replaceAll("&amp;", "&") ?? "", name: (found?.[2] ?? "").trim() };
}

describe("the notice a cut-short log carries", () => {
  /* The filter is the one control that reaches the dropped rows, so a notice naming the loss alone
     reads as the recorded history being unavailable. */
  it("says that a filter reaches the rows this page is missing", () => {
    assert.match(noticeText(view({ vollstaendig: false }), TITEL.gekappt), /Ein Filter holt dagegen auch Zeilen, die hier fehlen\./);
  });

  /* The search field sits above the same rows and does NOT re-read, so the two controls are named
     apart or the reader takes the sentence above for a property of both. */
  it("keeps the search bound to the loaded rows in the same breath", () => {
    assert.match(noticeText(view({ vollstaendig: false }), TITEL.gekappt), /Auch die Suche erfasst nur die geladenen Zeilen\./);
  });

  it("names the end the rows were served from", () => {
    assert.match(noticeText(view({ vollstaendig: false, richtung: "desc" }), TITEL.gekappt), /Geladen sind nur die neuesten Änderungen;/);
    assert.match(noticeText(view({ vollstaendig: false, richtung: "asc" }), TITEL.gekappt), /Geladen sind nur die ältesten Änderungen;/);
  });

  /* Non-vacuity for every case above, which would each pass on a notice that stands unconditionally
     and tells the reader a complete log is cut. */
  it("stands on a cut answer alone", () => {
    assert.doesNotMatch(view(), /unvollständig/);
  });

  it("counts the filters against the whole log, and against the narrowing where one is in force", () => {
    assert.match(noticeText(view({ vollstaendig: false }), TITEL.gekappt), /Die Zahlen an den Filtern zählen das ganze Protokoll\.$/);

    for (const narrowing of [{ dokumentId: ROW.document_id }, { vorgangId: ROW.trace_id }]) {
      assert.match(
        noticeText(view({ vollstaendig: false, ...narrowing }), TITEL.gekappt),
        /Die Zahlen an den Filtern zählen alle Zeilen der oben genannten Auswahl\.$/,
      );
    }
  });

  it("renders at warning rather than at the info the two narrowing notices take", () => {
    assert.equal(notice(view({ vollstaendig: false }), TITEL.gekappt).headingClass, headingAt("warning"));
    assert.notEqual(headingAt("warning"), headingAt("info"), "the two severities are indistinguishable, so this proves nothing");
  });

  /* A closed notice would leave a partial log looking whole. `Callout` names its close control
     „<Titel> ausblenden“, so the word's absence is the control's. */
  it("offers nothing to close any of the three notices with", () => {
    assert.doesNotMatch(view({ vollstaendig: false, dokumentId: ROW.document_id, vorgangId: ROW.trace_id }), /ausblenden/);
  });
});

describe("the notices a narrowing raises", () => {
  it("names the one record the list was narrowed to", () => {
    const gefunden = notice(view({ dokumentId: ROW.document_id }), TITEL.dokument);

    assert.match(textOf(gefunden.body), /Datensatz 68c1f0a2b3c4d5e6f7a8b9c0\./, "the notice names no record");
    assert.equal(gefunden.headingClass, headingAt("info"), "the narrowing is announced as loudly as the cut");
  });

  /* The number itself, because no cell renders it: the row action that led here put it in the URL, and
     a support request is answered by quoting it. */
  it("names the Vorgang, and says so where that one is answered whole", () => {
    const ganz = view({ vorgangId: ROW.trace_id });

    assert.match(noticeText(ganz, TITEL.vorgang), /Zeilen des Vorgangs 8f14e45fceea167a, vollständig\./);
    assert.equal(notice(ganz, TITEL.vorgang).headingClass, headingAt("info"), "the narrowing is announced as loudly as the cut");
    assert.match(noticeText(view({ vorgangId: ROW.trace_id, vollstaendig: false }), TITEL.vorgang), /Zeilen des Vorgangs 8f14e45fceea167a\./);
  });

  /* The way out keeps the shell on the selector's season, or the sidemenu and the season selector both
     fall back to the default the moment a reader leaves the narrowing. */
  it("carries the shell's season out of the narrowing, and writes no season where the URL names none", () => {
    const mitSaison = anchor(notice(view({ dokumentId: ROW.document_id }), TITEL.dokument).body);
    assert.equal(mitSaison.href, "/admin/aktionen?saison_id=2526");
    assert.equal(mitSaison.name, "Alle Änderungen anzeigen");

    assert.equal(anchor(notice(view({ vorgangId: ROW.trace_id }, ""), TITEL.vorgang).body).href, "/admin/aktionen");
  });

  it("raises neither notice while the URL narrows to nothing", () => {
    assert.doesNotMatch(view(), /Nur ein/);
  });

  /* Read top to bottom, the narrowing is what the rest of the page is about: a cut reported first reads
     as a property of the whole log rather than of the selection above it. */
  it("puts the narrowing above the notice about the cut", () => {
    const html = view({ vollstaendig: false, dokumentId: ROW.document_id, vorgangId: ROW.trace_id });
    const at = (titel: string) => {
      const stelle = html.indexOf(titel);
      assert.notEqual(stelle, -1, `the view no longer heads a notice: ${titel}`);

      return stelle;
    };

    assert.ok(at(TITEL.dokument) < at(TITEL.vorgang), "the record notice sits below the Vorgang's");
    assert.ok(at(TITEL.vorgang) < at(TITEL.gekappt), "the cut is reported above the narrowing that scoped it");
  });
});
