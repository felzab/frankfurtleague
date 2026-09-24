import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import tailwind from "@tailwindcss/postcss";
import { render } from "@testing-library/react";
import postcss from "postcss";

import type { AtRule, Container, Document, Root, Rule } from "postcss";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AppToaster } = await import("@/core/providers/AppToaster.tsx");
const { appToast } = await import("@/shared/utils/appToast.ts");

const compiled = (async (): Promise<Root> => {
  const from = path.join(import.meta.dirname, "globals.css");
  return (await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })).root;
})();

/** The sheet's cascade layers, earliest first, read once from its `@layer` statement. */
const layerOrder = (async (): Promise<string[]> =>
  (await compiled).nodes
    .filter((node): node is AtRule => node.type === "atrule" && node.name === "layer" && node.nodes === undefined)
    .map((statement) => statement.params.split(",").map((layer) => layer.trim()))
    .find((layers) => layers.includes("components") && layers.includes("utilities")) ?? assert.fail("globals.css orders no layers"))();

/**
 * A rule's selectors with every ancestor folded in: Tailwind emits a variant as a nested `&[data-…]`. Split by
 * postcss's `selectors`, which keeps a comma inside `:is(…)` or escaped in a class name, as `var(…,1)` is here.
 */
function selectorsOf(rule: Rule): string[] {
  const chain: Rule[] = [];
  for (let node: Container | Document | undefined = rule.parent; node != null; node = node.parent) {
    if (node.type === "rule") chain.unshift(node as Rule);
  }

  return [...chain, rule].reduce<string[]>(
    (outer, level) =>
      level.selectors.flatMap((part) =>
        outer.length === 0 ? [part] : outer.map((base) => (part.includes("&") ? part.replaceAll("&", base) : `${base} ${part}`)),
      ),
    [],
  );
}

interface Declaration {
  /** Every selector the declaration applies under, a pseudo-element's left out as another box than the one asked about. */
  selectors: string[];
  /** Tailwind writes an arbitrary value without the spaces the vendored sheet keeps, so both are read without them. */
  value: string;
  /** The `@layer` it sits in, or `null` for an unlayered one, which outranks every layer. */
  layer: string | null;
  /** Every other at-rule it sits under, such as a media query, which no check here evaluates. */
  conditions: string[];
  important: boolean;
}

/**
 * Every compiled declaration of a property `prop` matches. The checks below ask only which of them MATCH an element:
 * which one wins is a browser's to say, and each check is shaped so that no winner needs picking.
 */
async function declarationsOf(prop: RegExp): Promise<Declaration[]> {
  const order = await layerOrder;
  const found: Declaration[] = [];

  (await compiled).walkDecls((decl) => {
    if (!prop.test(decl.prop) || decl.parent?.type !== "rule") return;

    let layer: string | null = null;
    const conditions: string[] = [];
    for (let node: Container | Document | undefined = decl.parent.parent; node != null; node = node.parent) {
      if (node.type !== "atrule") continue;
      const atRule = node as AtRule;
      // A keyframe's `0%` is no selector.
      if (atRule.name === "keyframes") return;
      if (atRule.name !== "layer") conditions.push(atRule.params);
      // A layer the statement does not name ranks by first appearance instead, which no check here reads.
      else if (!order.includes(atRule.params)) assert.fail(`@layer ${atRule.params} is missing from the sheet's @layer statement`);
      else layer ??= atRule.params;
    }

    found.push({
      selectors: selectorsOf(decl.parent as Rule).filter((selector) => !selector.includes("::")),
      value: decl.value.replace(/\s+/g, ""),
      layer,
      conditions,
      important: decl.important,
    });
  });

  return found;
}

/** The declarations that apply to `element`, read with no pointer over it: jsdom matches no `:hover`. */
const matching = (element: Element, declarations: Declaration[]): Declaration[] =>
  declarations.filter((declaration) => declaration.selectors.some((selector) => element.matches(selector)));

type State = { frontmost: boolean; expanded: boolean; exiting: boolean };

/** Every stacking state HeroUI puts a toast in, as the three attributes it writes. */
const STATES: State[] = [false, true].flatMap((frontmost) =>
  [false, true].flatMap((expanded) => [false, true].map((exiting) => ({ frontmost, expanded, exiting }))),
);

const describeState = ({ frontmost, expanded, exiting }: State): string =>
  `${frontmost ? "front" : "stacked"}, ${expanded ? "expanded" : "collapsed"}, ${exiting ? "closing" : "resting"}`;

/** HeroUI writes `"true"` or nothing at all, never `"false"`. */
function enter(toast: Element, state: State): void {
  for (const [name, on] of [
    ["data-frontmost", state.frontmost],
    ["data-expanded", state.expanded],
    ["data-exiting", state.exiting],
  ] as const) {
    if (on) toast.setAttribute(name, "true");
    else toast.removeAttribute(name);
  }
}

/** One self-closing toast, rendered as the site renders it, and closed again once `read` is done with it. */
async function withToast(read: (toast: HTMLElement) => void): Promise<void> {
  render(h(AppToaster));
  await act(async () => {
    appToast.success("Gespeichert");
  });

  try {
    read(document.querySelector<HTMLElement>('[data-slot="toast"]') ?? assert.fail("AppToaster rendered no toast"));
  } finally {
    await act(async () => {
      appToast.clear();
    });
  }
}

/**
 * The scale each state rests at, mirroring `@heroui/styles` 3.2.6's `toast.css`, which moves without us: an expanded
 * toast full size, a collapsed one at the `--scale-collapsed` HeroUI writes inline.
 */
const restingScale = ({ expanded }: State): string => (expanded ? "1" : "var(--scale-collapsed,1)");

describe("the toast against HeroUI's stacking states", () => {
  it("leaves at the scale it rested at, in every state HeroUI shrinks it from", async () => {
    const scales = await declarationsOf(/^--toast-scale$/);

    await withToast((toast) => {
      let shrunk = 0;
      for (const state of STATES.filter((candidate) => candidate.exiting)) {
        const resting = restingScale(state);
        enter(toast, { ...state, exiting: false });
        // Tied to the vendored sheet: a resting value it does not declare is a mirror gone stale.
        assert.ok(
          matching(toast, scales).some((declaration) => declaration.layer === "components" && declaration.value === resting),
          `toast.css does not rest a ${describeState(state)} toast at ${resting}: re-read it and restamp`,
        );

        enter(toast, state);
        // One hold per state, so which of two the utilities layer ranks first never decides the scale.
        const holds = matching(toast, scales).filter((declaration) => declaration.layer === "utilities");
        assert.deepEqual(
          holds.map((declaration) => declaration.value),
          [resting],
          `a ${describeState(state)} toast is not held at the scale it rested at`,
        );
        if (matching(toast, scales).some((declaration) => declaration.layer === "components" && declaration.value !== resting)) shrunk++;
      }

      // Otherwise the hold overrides nothing, and a later HeroUI renaming the property would leave it holding air.
      assert.ok(shrunk > 0, "HeroUI no longer shrinks a closing toast through `--toast-scale`: re-read `toast.css` and restamp");
    });
  });

  /* The hold wins by layer order alone, and each of these outranks a later layer: an `!important` in an earlier
     one, an unlayered declaration, and an inline value. */
  it("lets nothing outrank the utilities layer on a closing toast's scale", async () => {
    const order = await layerOrder;
    const scales = await declarationsOf(/^--toast-scale$/);

    assert.equal(order.at(-1), "utilities", `globals.css orders its layers ${order.join(", ")}, so the utilities layer is not the last word`);

    await withToast((toast) => {
      for (const state of STATES.filter((candidate) => candidate.exiting)) {
        enter(toast, state);
        const outranking = matching(toast, scales).filter((declaration) => declaration.important || declaration.layer === null);
        assert.deepEqual(outranking, [], `a ${describeState(state)} toast's scale is decided above the utilities layer`);
        assert.equal(toast.style.getPropertyValue("--toast-scale"), "", "the toast's scale is written inline");
      }
    });
  });

  it("shows its close button on the resting front toast and on no other, without a pointer over it", async () => {
    // Addressed to the toast's button by its class: an element-wide default such as preflight's `button` rule matches
    // it too, and loses to every one of these.
    const byClass = (declarations: Declaration[]) =>
      declarations.filter((declaration) => declaration.selectors.some((selector) => selector.includes(".toast__close-button")));
    const opacities = byClass(await declarationsOf(/^opacity$/));
    const pointerEvents = byClass(await declarationsOf(/^pointer-events$/));

    await withToast((toast) => {
      const button = toast.querySelector('[data-slot="toast-close"]') ?? assert.fail("the toast renders no close button");

      for (const state of STATES) {
        enter(toast, state);
        const shown = state.frontmost && !state.exiting;
        // A rule that shows the button, wherever it sits: none may reach one HeroUI hides, whichever would win.
        const showing = matching(button, opacities).filter((declaration) => !["0", "0%"].includes(declaration.value));
        const pressable = matching(button, pointerEvents).filter((declaration) => declaration.value !== "none");

        assert.equal(showing.length > 0, shown, `a ${describeState(state)} toast's close button: ${JSON.stringify(showing)}`);
        assert.equal(pressable.length > 0, shown, `a ${describeState(state)} toast's close button: ${JSON.stringify(pressable)}`);
      }
    });
  });

  it("clips nothing outside an expanded toast, and clips the timer bar inside its own box", async () => {
    const overflows = await declarationsOf(/^overflow(?:-[xy])?$/);
    const radii = await declarationsOf(/^border-radius$/);

    await withToast((toast) => {
      for (const state of STATES.filter((candidate) => candidate.expanded)) {
        enter(toast, state);
        // The `::after` hit area HeroUI lays over the gap between expanded toasts sits outside the toast's box.
        const clipping = matching(toast, overflows).filter((declaration) => declaration.value !== "visible");
        assert.deepEqual(clipping, [], `a ${describeState(state)} toast clips its overflow`);
        assert.equal(toast.style.overflow, "", "the toast's overflow is written inline");
      }

      const timer = toast.querySelector(".toast__timer") ?? assert.fail("a self-closing toast renders no timer bar");
      const clip = timer.parentElement ?? assert.fail("the timer bar has no parent");
      // Its `rounded-[inherit]` takes its parent's corners, which are the toast's only where the toast is that parent.
      // `ok` over `===`: a failing `equal` serialises both elements, and with them the document, into its message.
      assert.ok(clip.parentElement === toast, "the timer bar's clip is not the toast's own child");

      const clipOverflow = matching(clip, overflows).map((declaration) => declaration.value);
      assert.ok(
        clipOverflow.length > 0 && clipOverflow.every((value) => value === "hidden"),
        `the timer bar's clip: ${clipOverflow.join(", ")}`,
      );
      const clipRadius = matching(clip, radii).map((declaration) => declaration.value);
      assert.ok(clipRadius.length > 0 && clipRadius.every((value) => value === "inherit"), `the timer bar's clip: ${clipRadius.join(", ")}`);
    });
  });
});
