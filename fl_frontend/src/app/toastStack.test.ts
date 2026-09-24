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

/** The sheet's cascade layers, earliest first. */
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

/**
 * Specificity for the selector shapes a toast rule takes — classes, attributes, `:not` over one simple selector, a
 * pseudo-class — as one comparable number. A shape outside those throws rather than being misjudged.
 */
function specificity(selector: string): number {
  // Escapes first: Tailwind's arbitrary-property class names escape `[`, `:` and `(`, which would read as syntax.
  let rest = selector
    .replace(/\\./g, "x")
    .replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "")
    .replace(/\[[^\]]*\]/g, " .attr ");
  if (/:(?:is|has)\(|#/.test(rest)) throw new Error(`the cascade model does not read ${selector}`);

  rest = rest.replace(/:not\(/g, " (");
  const pseudoClasses = rest.match(/(?<!:):[a-z-]+/g)?.length ?? 0;
  const classes = rest.match(/\.[\w-]+/g)?.length ?? 0;
  const types = rest.replace(/::?[a-z-]+/g, "").match(/(?:^|[\s>+~(])[a-z][\w-]*/g)?.length ?? 0;

  return (classes + pseudoClasses) * 1000 + types;
}

interface Declaration {
  selector: string;
  value: string;
  /** Position in the `@layer` order, unlayered outranking every layer. */
  layer: number;
  /** Under an at-rule other than `@layer`, which the model does not evaluate. */
  conditional: boolean;
}

/** Every compiled declaration of `prop` in source order, with the layer the cascade ranks it by. */
async function declarationsOf(prop: string): Promise<Declaration[]> {
  const order = await layerOrder;
  const found: Declaration[] = [];

  (await compiled).walkRules((rule) => {
    let layer = Number.POSITIVE_INFINITY;
    let conditional = false;
    for (let node: Container | Document | undefined = rule.parent; node != null; node = node.parent) {
      if (node.type !== "atrule") continue;
      const atRule = node as AtRule;
      // A keyframe's `0%` is no selector.
      if (atRule.name === "keyframes") return;
      if (atRule.name === "layer") layer = Math.min(layer, order.indexOf(atRule.params));
      else conditional = true;
    }

    // Own declarations only: `walkRules` visits the nested rules itself.
    for (const decl of rule.nodes) {
      if (decl.type !== "decl" || decl.prop !== prop) continue;
      // A pseudo-element is another box than the one asked about.
      for (const selector of selectorsOf(rule).filter((candidate) => !candidate.includes("::"))) {
        found.push({ selector, value: decl.value, layer, conditional });
      }
    }
  });

  return found;
}

/**
 * The value the cascade gives `element`, or `undefined` where nothing declares it. jsdom matches no `:hover`, so this is
 * the element with no pointer over it.
 */
function cascaded(element: Element, declarations: Declaration[], layerCeiling = Number.POSITIVE_INFINITY): string | undefined {
  const matching = declarations.filter((declaration) => declaration.layer <= layerCeiling && element.matches(declaration.selector));
  const conditional = matching.find((declaration) => declaration.conditional);
  if (conditional !== undefined) assert.fail(`${conditional.selector} decides under a media query the model does not read`);

  // Layer, then specificity, then the later declaration: `matching` is in source order, so a tie keeps the last.
  let winner: Declaration | undefined;
  for (const next of matching) {
    if (winner === undefined || next.layer > winner.layer) winner = next;
    else if (next.layer === winner.layer && specificity(next.selector) >= specificity(winner.selector)) winner = next;
  }

  // Tailwind writes an arbitrary value without the spaces the vendored sheet keeps.
  return winner?.value.replace(/\s+/g, "");
}

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
async function withToast(read: (toast: Element) => void): Promise<void> {
  render(h(AppToaster));
  await act(async () => {
    appToast.success("Gespeichert");
  });

  try {
    read(document.querySelector('[data-slot="toast"]') ?? assert.fail("AppToaster rendered no toast"));
  } finally {
    await act(async () => {
      appToast.clear();
    });
  }
}

describe("the toast against HeroUI's stacking states", () => {
  it("leaves at the scale it rested at, in every state HeroUI shrinks it from", async () => {
    const scales = await declarationsOf("--toast-scale");
    const components = (await layerOrder).indexOf("components");

    await withToast((toast) => {
      let shrunk = 0;
      for (const state of STATES.filter((candidate) => candidate.exiting)) {
        enter(toast, { ...state, exiting: false });
        const resting = cascaded(toast, scales);
        enter(toast, state);
        assert.equal(cascaded(toast, scales), resting, `a ${describeState(state)} toast changes its scale as it leaves`);
        if (cascaded(toast, scales, components) !== resting) shrunk++;
      }

      // Otherwise the hold overrides nothing, and a later HeroUI renaming the property would leave it holding air.
      assert.ok(shrunk > 0, "HeroUI no longer shrinks a closing toast through `--toast-scale`: re-read `toast.css` and restamp");
    });
  });

  it("shows its close button on the resting front toast and on no other, without a pointer over it", async () => {
    const opacities = await declarationsOf("opacity");
    const pointerEvents = await declarationsOf("pointer-events");

    await withToast((toast) => {
      const button = toast.querySelector('[data-slot="toast-close"]') ?? assert.fail("the toast renders no close button");

      for (const state of STATES) {
        enter(toast, state);
        const shown = state.frontmost && !state.exiting;
        // Tailwind writes `opacity-100` as `100%`; the vendored sheet may write either form.
        const opacity = cascaded(button, opacities);
        assert.equal(
          opacity === "100%" || opacity === "1",
          shown,
          `a ${describeState(state)} toast's close button: opacity ${String(opacity)}`,
        );
        assert.equal(cascaded(button, pointerEvents) === "auto", shown, `a ${describeState(state)} toast's close button: pointer events`);
      }
    });
  });

  it("clips nothing outside an expanded toast, and clips the timer bar inside its own box", async () => {
    const overflows = await declarationsOf("overflow");
    const radii = await declarationsOf("border-radius");

    await withToast((toast) => {
      for (const state of STATES.filter((candidate) => candidate.expanded)) {
        enter(toast, state);
        const overflow = cascaded(toast, overflows);
        // The `::after` hit area HeroUI lays over the gap between expanded toasts sits outside the toast's box.
        assert.ok(overflow === undefined || overflow === "visible", `a ${describeState(state)} toast clips its overflow: ${String(overflow)}`);
      }

      const timer = toast.querySelector(".toast__timer") ?? assert.fail("a self-closing toast renders no timer bar");
      const clip = timer.parentElement ?? assert.fail("the timer bar has no parent");
      assert.notEqual(clip, toast, "the timer bar sits on the toast itself, which may not clip it");
      assert.equal(cascaded(clip, overflows), "hidden", "nothing clips the timer bar to the toast's corners");
      assert.equal(cascaded(clip, radii), "inherit", "the timer bar's clip does not follow the toast's corners");
    });
  });
});
