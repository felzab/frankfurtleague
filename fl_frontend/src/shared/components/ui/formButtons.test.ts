/**
 * SHARED · what decides a button's box
 *
 * Three of this recipe's properties are settled by `@heroui/styles/components/button.css` rather than
 * by anything written here, and all three are invisible to the toolchain: `.button` fixes a height, it
 * scales on press, and it does both from `@layer components`, where a plain utility outranks it. A
 * recipe that omits the competing utility compiles, lints, builds and ships the vendored value — a
 * 36px control whose `py-*` never reaches the layout, and a press the app never asked for.
 *
 * So the recipe is asserted against the compiled stylesheet: that the vendored rule is still there to
 * be beaten, that the recipe still emits something that beats it, and that the layer order is still
 * what makes it win. The reduced-motion escape is asserted for the same reason — it lives unlayered in
 * `globals.css` and matches the press by class NAME, so a variant added in front of that class is a
 * silent regression for exactly the readers it exists for.
 *
 * The source guard is the fourth: every button raised over a page goes through the recipe, because a
 * call site spelling its own classes is how the family came apart in the first place.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

import { ctaButton, formButton } from "./formButtons";

import type { AtRule, Container, Document, Root, Rule } from "postcss";

const SRC = path.join(import.meta.dirname, "..", "..", "..");

const compiled = (async (): Promise<Root> => {
  const from = path.join(SRC, "app", "globals.css");
  return (await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })).root;
})();

const classesOf = (emitted: string): ReadonlySet<string> => new Set(emitted.split(/\s+/).filter(Boolean));

/**
 * Every button either recipe can render, one entry per class list an element actually receives —
 * asserted separately rather than as a union, because a union is satisfied by whichever variant still
 * happens to carry the property and says nothing about the one that dropped it.
 */
const VARIANTS: { name: string; classes: ReadonlySet<string> }[] = [
  ...(["submit", "cancel", "destructive", "trigger"] as const).flatMap((intent) => [
    { name: `formButton ${intent}`, classes: classesOf(formButton({ intent })) },
    { name: `formButton ${intent} fullWidth`, classes: classesOf(formButton({ intent, fullWidth: true })) },
  ]),
  ...(["primary", "outline"] as const).flatMap((intent) => [
    { name: `ctaButton ${intent}`, classes: classesOf(ctaButton({ intent, hover: "aria" })) },
    { name: `ctaButton ${intent} sm`, classes: classesOf(ctaButton({ intent, hover: "css", size: "sm" })) },
  ]),
];

/** The union, for the assertions about what may reach these buttons at all. */
const RECIPE_CLASSES: ReadonlySet<string> = new Set(VARIANTS.flatMap((variant) => [...variant.classes]));

/** The cascade layer a rule sits in, or `null` where it is unlayered and outranks all of them. */
function layerOf(rule: Rule): string | null {
  for (let node: Container | Document | undefined = rule.parent; node != null; node = node.parent) {
    if (node.type === "atrule" && (node as AtRule).name === "layer") return (node as AtRule).params;
  }
  return null;
}

/**
 * Selector parts that are one bare class and nothing else — no pseudo-class, attribute or combinator —
 * so what they declare reaches the element in every state.
 */
const BARE_CLASS = /^\.((?:\\.|[^\\.:[\s>+~])+)$/;

const unescape = (selector: string): string => selector.replace(/\\(.)/g, "$1");

/**
 * A rule's selectors with every ancestor folded in. Tailwind emits nested CSS verbatim, so the rule
 * carrying HeroUI's press transform reads `&:active, &[data-pressed="true"]` and says nothing about
 * `.button` until its parent is resolved into it.
 */
function selectorsOf(rule: Rule): string[] {
  const chain: Rule[] = [];
  for (let node: Container | Document | undefined = rule.parent; node != null; node = node.parent) {
    if (node.type === "rule") chain.unshift(node as Rule);
  }

  return [...chain, rule].reduce<string[]>(
    (outer, level) =>
      level.selector.split(",").flatMap((raw) => {
        const part = raw.trim();
        return outer.length === 0 ? [part] : outer.map((base) => (part.includes("&") ? part.replaceAll("&", base) : `${base} ${part}`));
      }),
    [],
  );
}

/** Where a property is declared unconditionally for any class in `classes`. */
function declaredUnconditionally(root: Root, classes: ReadonlySet<string>, prop: string): { value: string; layer: string | null }[] {
  const found: { value: string; layer: string | null }[] = [];

  root.walkRules((rule) => {
    const matches = selectorsOf(rule).some((selector) => {
      const captured = BARE_CLASS.exec(selector);
      return captured !== null && classes.has(unescape(captured[1]!));
    });
    if (!matches) return;

    for (const decl of rule.nodes) {
      if (decl.type === "decl" && decl.prop === prop) found.push({ value: decl.value, layer: layerOf(rule) });
    }
  });

  return found;
}

/** Every rule reaching `.button`, whatever else its selector demands. */
function buttonRules(root: Root, prop: string): { selector: string; value: string; layer: string | null }[] {
  const found: { selector: string; value: string; layer: string | null }[] = [];

  root.walkRules((rule) => {
    const selectors = selectorsOf(rule).filter((selector) => /(^|[^-\w])\.button([^-\w]|$)/.test(selector));
    if (selectors.length === 0) return;
    // Own declarations only: `walkDecls` would descend into the nested rules this walk visits anyway.
    for (const decl of rule.nodes) {
      if (decl.type === "decl" && decl.prop === prop) found.push({ selector: selectors.join(", "), value: decl.value, layer: layerOf(rule) });
    }
  });

  return found;
}

describe("the height HeroUI fixes and the recipe has to restate", () => {
  it("still finds `.button` declaring one", async () => {
    const heights = buttonRules(await compiled, "height");

    assert.ok(heights.length > 0, "HeroUI no longer fixes `.button`'s height — the recipe's own height is now unopposed, not load-bearing");
    assert.ok(
      heights.every((rule) => rule.layer === "components"),
      `expected every vendored height in @layer components; got ${JSON.stringify(heights.map((rule) => rule.layer))}`,
    );
  });

  for (const variant of VARIANTS) {
    it(`leaves ${variant.name} declaring its own, rather than at the vendored 36px`, async () => {
      const heights = declaredUnconditionally(await compiled, variant.classes, "height");

      assert.ok(heights.length > 0, `${variant.name} declares no height of its own and falls back to \`.button\`'s h-10 md:h-9`);
      assert.ok(
        heights.every((height) => height.layer === "utilities"),
        `${variant.name}'s height cannot outrank @layer components; got ${JSON.stringify(heights.map((height) => height.layer))}`,
      );
    });
  }
});

describe("the press HeroUI scales and the recipe has to suppress", () => {
  it("still finds `.button` scaling from an attribute no pointer event is needed to set", async () => {
    const transforms = buttonRules(await compiled, "transform").filter((rule) => rule.value.includes("scale("));

    assert.ok(transforms.length > 0, "HeroUI no longer scales `.button` — `transform-none` in the recipe is now inert, not load-bearing");
    // The attribute arm is the one `disabled:pointer-events-none` cannot reach: it needs no pointer.
    assert.ok(
      transforms.some((rule) => rule.selector.includes('[data-pressed="true"]')),
      "the vendored press no longer keys off `[data-pressed]`",
    );
  });

  for (const variant of VARIANTS) {
    it(`finds ${variant.name} cancelling it unconditionally`, async () => {
      const cancels = declaredUnconditionally(await compiled, variant.classes, "transform").filter((decl) => decl.value === "none");

      assert.ok(cancels.length > 0, `${variant.name} does not cancel the vendored press; a disabled one is still scaled by \`[data-pressed]\``);
      assert.ok(
        cancels.every((cancel) => cancel.layer === "utilities"),
        `${variant.name}'s cancellation is not in @layer utilities; got ${JSON.stringify(cancels.map((cancel) => cancel.layer))}`,
      );
    });
  }

  it("finds the layer order that lets the cancellation outrank it", async () => {
    const root = await compiled;

    // Layer order is compared before specificity, so this statement is the whole of why utilities wins.
    // The file opens with a second, unrelated statement (`@layer properties`), so the pair is what
    // identifies the ordering one rather than its position.
    const ordering = root.nodes
      .filter((node): node is AtRule => node.type === "atrule" && node.name === "layer" && node.nodes === undefined)
      .map((statement) => statement.params.split(",").map((layer) => layer.trim()))
      .find((layers) => layers.includes("components") && layers.includes("utilities"));

    assert.ok(ordering !== undefined, "globals.css no longer orders components against utilities");
    assert.ok(ordering.indexOf("utilities") > ordering.indexOf("components"), `utilities no longer follows components: ${ordering.join(", ")}`);
  });

  it("leaves the app's own scale as the only one, and behind `:active`, which a disabled control cannot match", async () => {
    const scales: string[] = [];

    (await compiled).walkRules((rule) => {
      const reaching = selectorsOf(rule).filter((selector) => {
        const captured = /^\.((?:\\.|[^\\.[\s>+~])+?)(:[a-z-]+)?$/.exec(selector);
        return captured !== null && RECIPE_CLASSES.has(unescape(captured[1]!));
      });
      if (reaching.length === 0) return;
      for (const decl of rule.nodes) if (decl.type === "decl" && decl.prop === "scale") scales.push(...reaching);
    });

    assert.ok(scales.length > 0, "the press no longer scales at all");
    assert.ok(
      scales.every((selector) => selector.includes(":active")),
      `a scale reaches these buttons outside the press: ${JSON.stringify(scales)}`,
    );
  });

  it("leaves the unlayered reduced-motion escape still matching the class the recipes emit", async () => {
    const escapes: { selector: string; unlayered: boolean }[] = [];

    (await compiled).walkRules((rule) => {
      if (!rule.some((node) => node.type === "decl" && node.prop === "scale" && node.important)) return;
      for (const selector of selectorsOf(rule)) escapes.push({ selector, unlayered: layerOf(rule) === null });
    });

    assert.ok(escapes.length > 0, "globals.css no longer escapes the press under prefers-reduced-motion");
    // It matches by class NAME, so a variant put in front of `active:scale-95` silently orphans it.
    const escaped = escapes.filter((escape) => {
      const captured = /^\.((?:\\.|[^\\.[\s>+~])+?):active$/.exec(escape.selector.trim());
      return captured !== null && RECIPE_CLASSES.has(unescape(captured[1]!));
    });
    assert.ok(escaped.length > 0, `the escape no longer names a class either recipe emits: ${JSON.stringify(escapes.map((e) => e.selector))}`);
    assert.ok(
      escaped.every((escape) => escape.unlayered),
      "the escape has fallen into a cascade layer and can no longer win",
    );
  });
});

/** Every component that raises something over a page: the modal folders, plus the shared dialog bodies. */
async function modalSources(): Promise<string[]> {
  const found: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      // Matched against the path BELOW `src`, never the absolute one: a checkout can sit in a directory
      // called anything, including `modals`, and the folder this is looking for is the app's own.
      // `EntityForm` is every create dialog's footer and lives beside the shared dialogs, in no such folder.
      const within = path.relative(SRC, full);
      if (within.split(path.sep).includes("modals") || /(Modal|EntityForm)\.tsx$/.test(entry.name)) found.push(full);
    }
  };

  await walk(SRC);
  return found;
}

describe("where a dialog's buttons get their appearance", () => {
  it("finds every one of them going through the recipe", async () => {
    const files = await modalSources();
    // Below this the walk has stopped finding the population rather than the population having shrunk.
    assert.ok(files.length >= 15, `expected the modal population; found ${String(files.length)}`);

    const spelledLocally: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (let at = source.indexOf("<Button"); at !== -1; at = source.indexOf("<Button", at + 1)) {
        const closes = source.indexOf("</Button>", at);
        const element = source.slice(at, closes === -1 ? undefined : closes);
        if (!element.includes("formButton("))
          spelledLocally.push(`${path.relative(SRC, file)} :: ${element.slice(0, 60).replace(/\s+/g, " ")}`);
      }
    }

    assert.deepEqual(spelledLocally, [], `a dialog button is spelling its own classes:\n${spelledLocally.join("\n")}`);
  });
});
