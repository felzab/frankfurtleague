import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

const SRC = path.resolve(import.meta.dirname, "..", "..");
const ADMIN = path.join(SRC, "app", "admin");

/**
 * Found by the attribute on the fallback, so a route that stops drawing a trigger's box drops out here and fails
 * `fl_frontend/src/shared/components/ui/AdminCrudView.test.ts`'s sweep over every route's shell instead.
 */
const ROUTES = readdirSync(ADMIN, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const loading = path.join(ADMIN, entry.name, "loading.tsx");
    const page = path.join(ADMIN, entry.name, "page.tsx");
    let source: string;
    try {
      source = readFileSync(loading, "utf8");
    } catch {
      return [];
    }
    if (!source.includes("createLabel=")) return [];

    const pageSource = readFileSync(page, "utf8");
    const imported = /import \{ (AdminCreate\w+Modal) \} from "@\/(features\/[^"]+)";/.exec(pageSource);
    assert.ok(imported !== null, `${entry.name}: its fallback draws a trigger's box and its page imports no create modal`);

    return [{ route: entry.name, loading, modalName: imported[1]!, modal: path.join(SRC, `${imported[2]!}.tsx`) }];
  });

/** The trigger's opening tag and its words, from whichever render drew it. */
const triggerIn = (html: string, opening: RegExp): { classes: string[]; words: string } => {
  const found = opening.exec(html);
  assert.ok(found !== null, "the render draws no trigger");

  return { classes: found[1]!.split(/\s+/).filter((className) => className !== "invisible"), words: textOf(found[2]!).trim() };
};

describe("the trigger's box a list route's fallback draws", () => {
  /* The bar beside the trigger takes what the trigger leaves, and the trigger is as wide as its classes and its
     words make it: a box drawn from either of another trigger moves the bar when the page arrives. */
  it("is the create modal's own trigger, class for class and word for word", async () => {
    // A floor rather than the roster: a sweep over no route answers clean.
    assert.ok(ROUTES.length >= 5, `${String(ROUTES.length)} routes draw a trigger's box`);

    for (const { route, loading, modalName, modal } of ROUTES) {
      const { default: Loading } = (await import(pathToFileURL(loading).href)) as { default: () => ReactNode };
      const Modal = ((await import(pathToFileURL(modal).href)) as Record<string, (props: Record<string, unknown>) => ReactNode>)[modalName]!;

      const shown = triggerIn(
        renderTree(underNext(h(Modal, { saisonOptions: [], defaultSaisonId: null }))),
        /<button[^>]*?class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/,
      );
      const drawn = triggerIn(renderTree(h(Loading)), /<div aria-hidden="true" class="(button[^"]*)">([\s\S]*?)<\/div>/);

      assert.notEqual(shown.words, "", `${route}: its trigger shows no words, so the box is compared to nothing`);
      assert.deepEqual(drawn, shown, `${route}: its fallback draws a trigger's box of other classes or other words`);
    }
  });

  /* The same arrival one boundary further in: a page whose trigger waits on a read of its own draws that wait inside
     the page's shell, where a box of another width moves the bar a second time. */
  it("is the box a page draws while its own trigger waits on a read", async () => {
    // Found from the page's own boundary rather than from the box it renders, which is the property asserted below.
    const waiting = ROUTES.filter(({ route }) =>
      /createModal=\{\s*<Suspense\b/.test(readFileSync(path.join(ADMIN, route, "page.tsx"), "utf8")),
    );
    assert.ok(waiting.length >= 2, `${String(waiting.length)} pages hold their trigger behind a boundary`);

    for (const { route, modalName, modal } of ROUTES) {
      const { default: Page } = (await import(pathToFileURL(path.join(ADMIN, route, "page.tsx")).href)) as {
        default: (props: { searchParams: Promise<Record<string, string>> }) => ReactNode;
      };
      const Modal = ((await import(pathToFileURL(modal).href)) as Record<string, (props: Record<string, unknown>) => ReactNode>)[modalName]!;

      const page = renderTree(underNext(h(Page, { searchParams: Promise.resolve({}) })));
      const box = /<div aria-hidden="true" class="(button[^"]*)">([\s\S]*?)<\/div>/;

      assert.equal(
        box.test(page),
        waiting.some((candidate) => candidate.route === route),
        `${route}: its page draws a trigger's box it holds no boundary for`,
      );
      if (!box.test(page)) continue;

      const shown = triggerIn(
        renderTree(underNext(h(Modal, { saisonOptions: [], defaultSaisonId: null }))),
        /<button[^>]*?class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/,
      );

      assert.deepEqual(triggerIn(page, box), shown, `${route}: its page waits on its trigger behind a box of other classes or other words`);
    }
  });
});
