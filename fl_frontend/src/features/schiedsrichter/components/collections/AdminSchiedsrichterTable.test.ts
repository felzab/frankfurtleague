import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `Link` reads the first and `useSaisonHref` the second — and
   the table renders under both. A Next release that moves either module fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { FLSchiedsrichter } from "../../schemas.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSchiedsrichterTable } = await import("./AdminSchiedsrichterTable.tsx");

const LIVE: FLSchiedsrichter = {
  id: "6890a1b2c3d4e5f607800001",
  name: "Anna Körner",
  schule: "Carl-Schurz-Schule",
  default_payment: 20,
  kontakt: { telefon: "069 1234567", email: "kontakt@example.com" },
  inactive_since: null,
  anonymisiert_am: null,
};

/**
 * A stored row carrying no name and nothing to copy. `name` is nullable on the read model, and the
 * write path never sends a null, so this row is what a hand-write leaves behind.
 */
const NAMENLOS: FLSchiedsrichter = {
  ...LIVE,
  id: "6890a1b2c3d4e5f607800002",
  name: null,
  schule: null,
  kontakt: { telefon: null, email: null },
};

/** Nameless with details still on it, which is the row that keeps every control a named one has. */
const NAMENLOS_MIT_KONTAKT: FLSchiedsrichter = { ...NAMENLOS, id: "6890a1b2c3d4e5f607800003", kontakt: LIVE.kontakt };

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const table = (rows: FLSchiedsrichter[]): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2026") },
        h(AdminSchiedsrichterTable, { filteredSchiedsrichter: rows, emptiness: "none", setDeletingSchiedsrichter: () => undefined }),
      ),
    ),
  );

/** Every accessible name the markup emits. Both layouts render, so a control appears once per layout. */
const namen = (html: string): string[] => [...html.matchAll(/aria-label="([^"]*)"/g)].map((treffer) => treffer[1] ?? "");

describe("the referee row's copy control", () => {
  /* `navigator.clipboard.writeText("")` resolves, so a row with nothing to copy would clear the
     clipboard the administrator was holding and the toast would report it as a copy. */
  it("is offered for a referee whose details are there and withheld for a row holding none", () => {
    const gelebt = namen(table([LIVE])).filter((name) => name.startsWith("Kontaktdaten"));
    const leer = namen(table([NAMENLOS])).filter((name) => name.startsWith("Kontaktdaten"));

    assert.ok(gelebt.length > 0, "the live row stopped offering the copy, so the case below proves nothing");
    assert.deepEqual(leer, [], "the empty row still offers a copy that would clear the clipboard");
  });

  /* The rest of the row survives an empty one, so a change that dropped every control would pass the
     case above for the wrong reason. */
  it("leaves the nameless row its other controls", () => {
    const leer = namen(table([NAMENLOS]));

    assert.ok(
      leer.some((name) => name.includes("bearbeiten")),
      "the nameless row lost the link to its editor",
    );
  });
});

describe("what a screen reader is told a row is about", () => {
  /* The word is rendered in italics precisely so a reader takes it for a state, and italics reach a
     screen reader as nothing: a label carrying it announces „anonym“ as this person's name. */
  it("names the state on a nameless row and the referee on a named one", () => {
    // Both nameless rows, because a control withheld for want of a value is a control the assertion
    // never reaches: the copy is the one this row's empty twin does not render.
    const leer = [...namen(table([NAMENLOS])), ...namen(table([NAMENLOS_MIT_KONTAKT]))];
    const gelebt = namen(table([LIVE]));

    assert.ok(
      leer.every((name) => !name.includes(SCHIEDSRICHTER_ANONYM_LABEL)),
      `a control announces „${SCHIEDSRICHTER_ANONYM_LABEL}“ as a name: ${leer.join(" · ")}`,
    );
    assert.ok(
      leer.some((name) => name.includes("ohne Namen")),
      "no control on the nameless row says the name is missing",
    );
    assert.ok(
      gelebt.some((name) => name.includes(LIVE.name ?? "")),
      "a named row stopped naming the referee its controls act on",
    );
  });
});
