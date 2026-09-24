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

/**
 * The sheet's cascade layers, earliest first, each ranked where the sheet first names it, as a browser ranks it:
 * Tailwind opens with a `properties` layer of its own ahead of the sheet's `@layer` statement.
 */
const layerOrder = (async (): Promise<string[]> => {
  const order: string[] = [];
  (await compiled).walkAtRules("layer", (layer) => {
    for (const name of layer.params.split(",").map((part) => part.trim())) if (!order.includes(name)) order.push(name);
  });

  return order;
})();

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
  prop: string;
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
      else layer ??= atRule.params;
    }

    found.push({
      selectors: selectorsOf(decl.parent as Rule).filter((selector) => !selector.includes("::")),
      prop: decl.prop,
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

  /* The site's reduced-motion policy is "remove movement, keep fades" (`globals.css`), and HeroUI's `motion-reduce`
     arms, a media query and a `data-reduce-motion` ancestor, each stop every toast transition. Whether the fade then
     renders is a browser's to show. */
  it("fades in and out under reduced motion, on HeroUI's own timing, and moves not at all", async () => {
    const REDUCED = "(prefers-reduced-motion: reduce)";
    const transitions = await declarationsOf(/^(?:transition-property|--tw-duration|--tw-ease)$/);
    const timing = await declarationsOf(/^--toast-(?:opacity-duration|ease)$/);

    await withToast((toast) => {
      enter(toast, { frontmost: true, expanded: false, exiting: false });
      // A var() nothing declares leaves the duration invalid, which a browser reads as none at all.
      const declared = matching(toast, timing).filter((declaration) => declaration.layer === "components");
      for (const name of ["--toast-opacity-duration", "--toast-ease"]) {
        assert.ok(
          declared.some((declaration) => declaration.prop === name),
          `toast.css does not declare ${name} on the toast: re-read it and restamp`,
        );
      }

      for (const arm of ["media", "attribute"] as const) {
        if (arm === "attribute") toast.setAttribute("data-reduce-motion", "true");
        const reduced = matching(toast, transitions).filter((declaration) =>
          arm === "media"
            ? declaration.conditions.includes(REDUCED)
            : declaration.selectors.some((selector) => selector.includes("data-reduce-motion")),
        );
        const valuesOf = (prop: string, layer: string) =>
          reduced.filter((declaration) => declaration.layer === layer && declaration.prop === prop).map(({ value }) => value);

        // Otherwise there is nothing to restore, and a later HeroUI keeping its transitions would leave this a second copy.
        assert.ok(
          valuesOf("transition-property", "components").includes("none"),
          `HeroUI does not stop the toast's transitions (${arm}): re-read toast.css and restamp`,
        );
        assert.deepEqual(valuesOf("transition-property", "utilities"), ["opacity"], `the toast's reduced-motion transitions (${arm})`);
        assert.deepEqual(valuesOf("--tw-duration", "utilities"), ["var(--toast-opacity-duration)"], `the fade's duration (${arm})`);
        assert.deepEqual(valuesOf("--tw-ease", "utilities"), ["var(--toast-ease)"], `the fade's easing (${arm})`);
      }
      toast.removeAttribute("data-reduce-motion");
    });
  });
});

/* HeroUI suspends every toast timer while the page is hidden, where the bar's animation keeps the document's clock: a
   bar left running reads drained on return over a toast that still stands for its whole remaining time. */
describe("the toast's timer bar on a hidden page", () => {
  it("stops while the page is hidden and runs again on return", async () => {
    let hidden = false;
    // jsdom's page never hides, so its getter is shadowed for this case and handed back after it.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

    try {
      await withToast((toast) => {
        const timer = toast.querySelector<HTMLElement>(".toast__timer") ?? assert.fail("a self-closing toast renders no timer bar");
        const turn = (to: boolean): void => {
          void act(() => {
            hidden = to;
            document.dispatchEvent(new Event("visibilitychange"));
          });
        };

        assert.equal(
          timer.style.animationPlayState,
          "",
          "the bar's play state is written inline on a visible page, over the stylesheet's hover pause",
        );
        turn(true);
        assert.equal(timer.style.animationPlayState, "paused", "the bar drains on while the page is hidden");
        turn(false);
        assert.equal(timer.style.animationPlayState, "", "the bar stays stopped once the page is back");
      });
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
  });
});
