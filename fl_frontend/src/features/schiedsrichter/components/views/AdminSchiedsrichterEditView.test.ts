import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — the form reads the router and `useSaisonHref` the query
   — and this view mounts both arms under them. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants.ts";
import { nextRouter } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSchiedsrichterEditView } = await import("./AdminSchiedsrichterEditView.tsx");

/** Every field but `name` held fixed, which is the one each case varies. */
const RECORD = {
  id: "6890a1b2c3d4e5f607800001",
  schule: "Carl-Schurz-Schule",
  kontakt: { telefon: "069 1234567", email: "kontakt@example.com" },
  default_payment: 20,
};

const view = (props: { name: string | null; inactiveSince: string | null }): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: nextRouter() },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2526") },
        h(AdminSchiedsrichterEditView, {
          schiedsrichter: { ...RECORD, name: props.name },
          inactiveSince: props.inactiveSince,
        }),
      ),
    ),
  );

/** The name box every row this route serves is offered, there being one page and no read-only arm. */
const hasNameInput = (html: string): boolean => /<input[^>]*name="name"/.test(html);

describe("which page a referee's editor route answers with", () => {
  /* Every id this route serves is a person somebody can still edit: an erased referee's row is gone
     and the ghost answers not-found on every by-id route, so neither reaches this component at all. */
  it("gives a nameless row the editor, a missing id being the route's own not-found answer", () => {
    const html = view({ name: null, inactiveSince: null });

    assert.ok(hasNameInput(html), "a row somebody left nameless is presented read-only");
    assert.doesNotMatch(textOf(html, " "), /Daten gelöscht/, "a deletion is claimed over a row nothing deleted");
  });

  /* Italic „anonym“ names a deletion, and a screen reader hears neither the italics nor the
     difference: the heading has to say this row is merely unfinished. */
  it("heads the nameless row with the word the list uses for it", () => {
    assert.match(textOf(view({ name: null, inactiveSince: null }), " "), new RegExp(SCHIEDSRICHTER_OHNE_NAMEN_LABEL));
  });
});
