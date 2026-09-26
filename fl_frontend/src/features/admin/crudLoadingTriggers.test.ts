import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h, Suspense } from "react";

import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderPage } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { PageProps } from "@/shared/testing/pageHarness.ts";
import type { ReactElement, ReactNode } from "react";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

doubleEveryAction();

const ADMIN = path.resolve(import.meta.dirname, "..", "..", "app", "bereich", "admin");

/** The trigger's box a fallback draws, laid out and never painted. */
const BOX = /<div aria-hidden="true" class="(button[^"]*)">([\s\S]*?)<\/div>/;

const PROPS: PageProps = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

type ListPage = (props: PageProps) => ReactElement<{ createModal?: ReactNode }>;

/**
 * Found by the box its fallback draws, so a route that stops drawing one drops out here and fails
 * `fl_frontend/src/shared/components/ui/AdminCrudView.test.ts`'s sweep over every route's shell instead.
 */
const ROUTES: { route: string; drawn: string; Page: ListPage; createModal: ReactNode }[] = [];
for (const entry of readdirSync(ADMIN, { withFileTypes: true })) {
  const loading = path.join(ADMIN, entry.name, "loading.tsx");
  if (!entry.isDirectory() || !existsSync(loading)) continue;

  const { default: Loading } = (await import(pathToFileURL(loading).href)) as { default: () => ReactNode };
  const drawn = renderTree(h(Loading));
  if (!BOX.test(drawn)) continue;

  const { default: Page } = (await import(pathToFileURL(path.join(ADMIN, entry.name, "page.tsx")).href)) as { default: ListPage };
  const { createModal } = Page(PROPS).props;
  assert.ok(createModal !== undefined, `${entry.name}: its fallback draws a trigger's box and its page's shell passes no create modal`);

  ROUTES.push({ route: entry.name, drawn, Page, createModal });
}

/** The trigger's opening tag and its words, from whichever render drew it. */
const triggerIn = (html: string, opening: RegExp): { classes: string[]; words: string } => {
  const found = opening.exec(html);
  assert.ok(found !== null, "the render draws no trigger");

  return { classes: found[1]!.split(/\s+/).filter((className) => className !== "invisible"), words: textOf(found[2]!).trim() };
};

/** The trigger the page's shell is handed, drawn once whatever it waits on has arrived. */
const shownBy = async (createModal: ReactNode) =>
  triggerIn(await renderPage(underNext(createModal)), /<button[^>]*?class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/);

describe("the trigger's box a list route's fallback draws", () => {
  /* The bar beside the trigger takes what the trigger leaves, and the trigger is as wide as its classes and its
     words make it: a box drawn from either of another trigger moves the bar when the page arrives. */
  it("is the create modal's own trigger, class for class and word for word", async () => {
    // A floor rather than the roster: a sweep over no route answers clean.
    assert.ok(ROUTES.length >= 5, `${String(ROUTES.length)} routes draw a trigger's box`);

    for (const { route, drawn, createModal } of ROUTES) {
      const shown = await shownBy(createModal);

      assert.notEqual(shown.words, "", `${route}: its trigger shows no words, so the box is compared to nothing`);
      assert.deepEqual(triggerIn(drawn, BOX), shown, `${route}: its fallback draws a trigger's box of other classes or other words`);
    }
  });

  /* The same arrival one boundary further in: a page whose trigger waits on a read of its own draws that wait inside
     the page's shell, where a box of another width moves the bar a second time. */
  it("is the box a page draws while its own trigger waits on a read", async () => {
    // Found from the page's own boundary rather than from the box it renders, which is the property asserted below.
    const waiting = ROUTES.filter(({ createModal }) => (createModal as ReactElement | null)?.type === Suspense);
    // A floor of one, because one route taking the boundary arm is what keeps the `assert.equal`
    // below from comparing `false` with `false` on every route and passing over the arrangement.
    assert.ok(
      waiting.length >= 1,
      `${String(waiting.length)} pages hold their trigger behind a boundary, so the waiting arm is never exercised`,
    );

    for (const { route, Page, createModal } of ROUTES) {
      const page = renderTree(underNext(h(Page, PROPS)));

      assert.equal(
        BOX.test(page),
        waiting.some((candidate) => candidate.route === route),
        `${route}: its page draws a trigger's box it holds no boundary for`,
      );
      if (!BOX.test(page)) continue;

      assert.deepEqual(
        triggerIn(page, BOX),
        await shownBy(createModal),
        `${route}: its page waits on its trigger behind a box of other classes or other words`,
      );
    }
  });
});
