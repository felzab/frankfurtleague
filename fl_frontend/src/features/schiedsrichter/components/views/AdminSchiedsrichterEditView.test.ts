import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — the form reads the router and `useSaisonHref` the query
   — and this view mounts both arms under them. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSchiedsrichterEditView } = await import("./AdminSchiedsrichterEditView.tsx");

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** Every field but `name` held fixed, which is the one each case varies. */
const RECORD = {
  id: "6890a1b2c3d4e5f607800001",
  schule: "Carl-Schurz-Schule",
  kontakt: { telefon: "069 1234567", email: "kontakt@example.com" },
  default_payment: 20,
};

const view = (props: { name: string | null; inactiveSince: string | null; anonymisiertAm: string | null }): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2526") },
        h(AdminSchiedsrichterEditView, {
          schiedsrichter: { ...RECORD, name: props.name },
          inactiveSince: props.inactiveSince,
          anonymisiertAm: props.anonymisiertAm,
        }),
      ),
    ),
  );

/** The name box, which the read-only readout has none of. */
const hasNameInput = (html: string): boolean => /<input[^>]*name="name"/.test(html);

describe("which page a referee's editor route answers with", () => {
  /* `find_anonymisation_undo_refusal` accepts a save on an unstamped row, so a readout here would
     present a live, still-bookable referee read-only with no route out. */
  it("gives a nameless row that was never stamped the editor, not the erasure readout", () => {
    const html = view({ name: null, inactiveSince: null, anonymisiertAm: null });

    assert.ok(hasNameInput(html), "a row nobody erased is presented as an erased one");
    assert.doesNotMatch(textOf(html, " "), /Daten gelöscht/, "the erasure's panel heading stands over a row nothing deleted");
  });

  /* The stamp is the erasure's only record, and the page it routes to is what the write path's
     refusal leaves an administrator with. */
  it("gives a stamped row the readout, with no box inviting the re-entry the save refuses", () => {
    const html = view({ name: null, inactiveSince: "2026-04-01", anonymisiertAm: "2026-04-01" });

    assert.ok(!hasNameInput(html), "the erased row is offered an editable name again");
    assert.match(textOf(html, " "), /Daten gelöscht/, "the erased row's page no longer says the data are gone");
  });

  /* Italic „anonym“ names a deletion, and a screen reader hears neither the italics nor the
     difference: the heading has to say which of the two states this row is in. */
  it("heads the nameless row with the word the list uses for it", () => {
    assert.match(textOf(view({ name: null, inactiveSince: null, anonymisiertAm: null }), " "), new RegExp(SCHIEDSRICHTER_OHNE_NAMEN_LABEL));
  });
});
