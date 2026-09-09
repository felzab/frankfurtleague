import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context, and the erasure panel reads both. A Next release that
   moves either module fails this file at import rather than quietly. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";

import { ERASURE_NEEDS_RETIREMENT } from "./constants.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { buildSpielerBanners } = await import("./components/forms/AdminSpielerEditForm/banners.ts");
const { AdminCreateSpielerForm } = await import("./components/forms/AdminCreateSpielerForm.tsx");
const { FormAustragenSection } = await import("./components/forms/AdminSpielerEditForm/FormAustragenSection.tsx");
const { FormLoeschenSection } = await import("./components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx");

/**
 * A masculine word standing for the pupil: the demonstrative on the noun, the possessive, and the
 * third-person pronoun. The noun's own article is not one — `Der Spieler` names the record.
 */
const MASKULIN = /\bdieser spieler\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;

/** What `useRouter` hands the erasure panel. `bfcacheId` is a value rather than a call. */
const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

/** The sentences a reader hears, with the markup taken out and the JSX line breaks collapsed. */
const gelesen = (html: string): string => textOf(html).replace(/\s+/g, " ").trim();

const unterDenKontexten = (element: Parameters<typeof renderTree>[0]): string =>
  renderTree(h(AppRouterContext.Provider, { value: ROUTER }, h(SearchParamsContext.Provider, { value: new URLSearchParams() }, element)));

describe("the squad-row panel a player is taken out of a season on", () => {
  const gezeigt = (): string =>
    gelesen(
      renderMarkup(FormAustragenSection, {
        spielerId: "68c1f0a2b3c4d5e6f7a8b9c0",
        saisonId: "2026",
        rowInactiveSince: null,
        isRowTeamInSaison: true,
        isRowSquadFull: false,
        banners: [],
      }),
    );

  /* The row and the person are two subjects here, and the surviving `sein` belongs to the row: it is
     the entry's club that a replacement can take out of the season. */
  it("hangs the condition on the Kadereintrag rather than on the pupil", () => {
    const text = gezeigt();

    assert.match(text, /Der Kadereintrag bleibt gespeichert/, "the entry stopped being the sentence's subject");
    assert.match(text, /solange sein Team in der Saison dabei ist/, "the copy states no condition at all");
    assert.ok(!/\bSein Eintrag\b/.test(text), "the entry is the pupil's possession again");
  });
});

describe("the erasure panel", () => {
  const gezeigt = (isRetired: boolean): string =>
    gelesen(
      unterDenKontexten(
        h(FormLoeschenSection, { spielerId: "68c1f0a2b3c4d5e6f7a8b9c0", fullName: "Lena Bergmann", isRetired: isRetired, membershipCount: 2 }),
      ),
    );

  it("names the pupil as this panel's own prose already does, in both of its arms", () => {
    const gesperrt = gezeigt(false);

    assert.match(gesperrt, /Diese Person ist nicht stillgelegt/, "the notice heads the refusal with a masculine demonstrative");
    assert.ok(gesperrt.includes(ERASURE_NEEDS_RETIREMENT), "the notice no longer carries the repair the action toasts");
    // Both arms, the offered one being where the press actually stands.
    for (const [arm, text] of [
      ["the blocked arm", gesperrt],
      ["the offered arm", gezeigt(true)],
    ] as const) {
      assert.doesNotMatch(text, MASKULIN, `${arm}: the panel names the pupil with a masculine word`);
    }
  });
});

describe("the note a create carries where the season has already begun", () => {
  const gezeigt = (): string =>
    gelesen(
      renderMarkup(AdminCreateSpielerForm, {
        saisonOptions: [{ saisonId: "2026", isNachgetragen: true, teams: [], erlaubteStufen: [] }],
        defaultSaisonId: "2026",
        onClose: () => undefined,
      }),
    );

  /* One wording for one fact: the editor raises the same two sentences as a banner, and a reader who
     creates and then edits meets both. */
  it("says what the editor's own banner says, word for word", () => {
    const banner = buildSpielerBanners({
      isRetired: false,
      saisonId: "2026",
      saisonStatus: "active",
      isMember: false,
      rowInactiveSince: null,
      isRowTeamInSaison: true,
      isNachgetragen: false,
      isTeamChanged: false,
      isSquadFull: false,
      blockedRolle: null,
    }).find(({ id }) => id === "spieler.entry-nachgetragen");

    assert.ok(banner !== undefined, "the editor raises no banner for the flag, so this case judges nothing");
    assert.ok(gezeigt().includes(`${banner.title}. ${banner.body}`), "the form and the banner word the flag differently");
    assert.doesNotMatch(banner.title, MASKULIN, "the shared wording names the pupil with a masculine word");
  });
});

describe("the retirement dialog's second step", () => {
  /* Read from source: the sentence is a prop the modal renders on its armed step alone, and arming
     it takes a press this runner has no DOM to make. */
  const MODAL = readFileSync(path.resolve(import.meta.dirname, "components", "modals", "AdminDeleteSpielerModal.tsx"), "utf8");

  it("names the pupil neutrally in the consequence it escalates to", () => {
    const satz = /consequence="([^"]*)"/.exec(MODAL)?.[1];

    assert.ok(satz !== undefined, "the dialog states no consequence this case can read");
    assert.match(satz, /Die Kadereinträge dieser Person bleiben/, "the consequence stopped naming what survives");
    assert.doesNotMatch(satz, MASKULIN, "the consequence names the pupil with a masculine word");
  });
});

describe("the sentences the player's own write paths answer with", () => {
  /* Read from source: a server action cannot be invoked in this runner, and two of these three are
     literals inside one, the third a module-private refusal. */
  const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

  it("names the pupil neutrally in each of them", () => {
    const genannt: string[] = [];

    for (const [was, satz] of [
      ["the duplicate squad row", /reason: "([^"]*schon einen Kadereintrag[^"]*)"/],
      ["the create whose squad row failed", /"(Nimm [^"]*Spielerseite[^"]*)"/],
      ["the retirement", /message: "(Die Kadereinträge dieser Person[^"]*)"/],
    ] as const) {
      const gefunden = satz.exec(ACTIONS)?.[1];

      assert.ok(gefunden !== undefined, `${was}: the action states no sentence this case can read`);
      if (MASKULIN.test(gefunden)) genannt.push(was);
    }

    assert.deepEqual(genannt, [], "an answer names the pupil with a masculine word");
  });

  /* The repair the erasure refusal points at, which the panel above renders and the action toasts. */
  it("names the pupil neutrally in the erasure's precondition", () => {
    assert.doesNotMatch(ERASURE_NEEDS_RETIREMENT, MASKULIN, "the repair names the pupil with a masculine word");
    assert.match(ERASURE_NEEDS_RETIREMENT, /in ihrer Zeile/, "the repair stopped saying which row holds the control");
  });
});
