import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSperrlisteEintrag } from "@/features/sperrliste/schemas.ts";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView.tsx";

/** The removal each row offers: a real one needs a session and a backend. */
doubleActions({ modules: ["/src/features/sperrliste/actions.ts"] });

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminSperrlisteList } = await import("./AdminSperrlisteList.tsx");
const { SPERRLISTE_CRUD_COPY } = await import("@/features/sperrliste/constants.ts");

/**
 * Two bans whose every field differs, so an assertion reaching a reason or an administrator cannot
 * be satisfied by the row beside it.
 */
const SPERREN: FLSperrlisteEintrag[] = [
  {
    id: "6890a1b2c3d4e5f607190001",
    grund: "Falsches Geburtsdatum angegeben",
    erstellt_von: "vorstand@example.org",
    erstellt_am: "2026-03-12",
    gesperrt_bis_saison_id: "2031",
  },
  {
    id: "6890a1b2c3d4e5f607190002",
    grund: "Wiederholt fremde Namen eingetragen",
    erstellt_von: "turnier@example.org",
    erstellt_am: "2026-04-02",
    gesperrt_bis_saison_id: "2032",
  },
];

const listMarkup = (sperren: FLSperrlisteEintrag[], emptiness: CrudEmptiness = "none"): string =>
  renderTree(h(AdminSperrlisteList, { filteredSperren: sperren, emptiness }));

/** Every address the markup carries, which is what „serves no address“ is checked against. */
const addressesIn = (html: string): string[] => [...html.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)].map((found) => found[0]);

/** The words on each button, which is both what a reader acts on and what speech input finds it by. */
const buttonNamesIn = (html: string): string[] =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((hit) =>
    textOf(hit[1] ?? "", " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

describe("what a row of the ban list shows", () => {
  it("carries its reason, its administrator and the day it was entered", () => {
    const html = listMarkup(SPERREN);

    for (const sperre of SPERREN) {
      assert.ok(html.includes(sperre.grund), `the row does not show „${sperre.grund}“`);
      assert.ok(html.includes(sperre.erstellt_von), `the row does not show ${sperre.erstellt_von}`);
    }

    assert.ok(html.includes("12.03.2026"), "the row shows no German day for the first ban");
    assert.ok(html.includes("02.04.2026"), "the row shows no German day for the second ban");
  });

  /* The row lapses on its own, so an administrator reading the list without this number cannot tell
     a ban that still bars from one the next activation will take. */
  it("says which season each ban runs to, and says it is the last barred one", () => {
    const html = listMarkup(SPERREN);

    for (const sperre of SPERREN) {
      assert.ok(html.includes(sperre.gesperrt_bis_saison_id), `the row does not show the season ${sperre.gesperrt_bis_saison_id}`);
    }

    // „bis 2031“ alone reads as the season the ban ends in, which is a year early.
    assert.ok(html.includes("einschließlich"), "the row leaves the named season open to being read as the first free one");
  });

  /* The whole point of the keyed hash: the banned address is stored nowhere a reader can reach, so
     the only address on screen is the administrator's own. */
  it("shows no address but the administrator's", () => {
    assert.deepEqual(addressesIn(listMarkup(SPERREN)), ["vorstand@example.org", "turnier@example.org"]);
  });

  /* `docs/frontend/spec.md :: I237`, and the markup is what carries it at every width: a table hidden
     below `md` is still a table above it. */
  it("renders the rows as a card list rather than a table", () => {
    const html = listMarkup(SPERREN);

    assert.doesNotMatch(html, /<table\b/, "the rows render as a table");
    assert.match(html, /<ul[^>]*aria-label="Liste aller Sperren"/, "the cards stand in no named list");
    assert.equal(html.match(/<li\b/g)?.length, SPERREN.length, "the list renders a card per ban");
  });

  /* The card prints the reason directly above this control, and the reason is up to 500 characters
     an administrator typed: a name quoting it reads that text out twice and identifies no row. */
  it("names each row's removal control for that ban's day, and never for its reason", () => {
    const names = buttonNamesIn(listMarkup(SPERREN));

    assert.equal(names.length, SPERREN.length, "the list renders one removal control per ban");
    assert.ok(
      names.some((name) => name.includes("12.03.2026")) && names.some((name) => name.includes("02.04.2026")),
      `a control is named for another ban's day: ${names.join(" | ")}`,
    );
    for (const sperre of SPERREN) {
      assert.ok(!names.some((name) => name.includes(sperre.grund)), `a control repeats the reason „${sperre.grund}“ the card already shows`);
    }
  });

  /* Each narrowing stage asks something different of the reader, and a list emptied by a search must
     not read as one nobody has filled. */
  it("names the narrowing that emptied it", () => {
    assert.ok(listMarkup([], "none").includes(SPERRLISTE_CRUD_COPY.emptyOverall));
    assert.ok(listMarkup([], "searched").includes(SPERRLISTE_CRUD_COPY.emptyForQuery));
    assert.ok(listMarkup([], "filtered").includes(SPERRLISTE_CRUD_COPY.emptyForQuery), "a narrowing no control can cause has copy of its own");
  });
});
