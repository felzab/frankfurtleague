import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { Facet } from "@/shared/utils/facets";
import type { Rule as CssRule } from "postcss";
import type { ReactNode } from "react";
import type { AdminCrudShape } from "./AdminCrudFallback";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminCrudFallback } = await import("./AdminCrudFallback.tsx");
const { AdminCrudLoading } = await import("./AdminCrudLoading.tsx");
const { AdminCrudShell } = await import("./AdminCrudShell.tsx");
const { AdminCrudView } = await import("./AdminCrudView.tsx");
const { SearchBar } = await import("./SearchBar.tsx");

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

const SHAPES: readonly AdminCrudShape[] = ["table", "cards", "sections"];

/* The variant family the reader below must tell from a `has-` on the element itself, which nothing
   in the tree wears. */
const REACHES_UPWARD = "group-has-[tbody]:[--admin-region-held:var(--admin-placeholder-hold)]";

type Compiled = { selector: string; banded: boolean; gated: boolean; declarations: Map<string, string> };

/** The class Tailwind escaped into a selector, beside whatever the rule demands past it. */
function subject(selector: string): { name: string; rest: string } | null {
  if (!selector.startsWith(".")) return null;

  let name = "";
  let at = 1;
  for (; at < selector.length; at++) {
    const character = selector[at]!;
    if (character === "\\") {
      name += selector[++at] ?? "";
      continue;
    }
    if (".:#[ >+~,()".includes(character)) break;
    name += character;
  }

  return name === "" ? null : { name: name, rest: selector.slice(at) };
}

const STYLESHEET = path.join(SRC, "app", "globals.css");
/* Declared rather than left to the scanner, which reads this file and emits the candidate anyway: a
   sweep asserting over a fixture it did not declare is `.claude/rules/cross-surface.md :: sweeps`. */
const compiled = await postcss([tailwind()]).process(`${await readFile(STYLESHEET, "utf8")}\n@source inline("${REACHES_UPWARD}");\n`, {
  from: STYLESHEET,
});

/** Every rule the app's own stylesheet compiles, under the class name its selector is built on. */
const RULES = new Map<string, Compiled[]>();

/** The theme the app compiles against, which is where a utility's own arithmetic reads its step from. */
const THEME: Record<string, string> = {};

// `@layer` wraps every utility, so only a `@media` ancestor makes a rule one band's rather than both.
const BANDED = new Set<CssRule>();
compiled.root.walkAtRules("media", (query) => {
  query.walkRules((rule) => {
    BANDED.add(rule);
  });
});

compiled.root.walkRules((rule) => {
  const declarations = new Map<string, string>();
  for (const node of rule.nodes) if (node.type === "decl") declarations.set(node.prop, node.value);

  const banded = BANDED.has(rule);

  for (const selector of rule.selectors) {
    if (selector.includes(":root")) for (const [property, value] of declarations) if (property.startsWith("--")) THEME[property] = value;

    const opened = subject(selector);
    if (opened === null) continue;

    const found = { selector: selector, banded: banded, gated: opened.rest !== "", declarations: declarations };
    RULES.set(opened.name, [...(RULES.get(opened.name) ?? []), found]);
  }
});

/** Which `@keyframes` write a custom property, under the property's own name. */
const WRITING = new Map<string, string[]>();
compiled.root.walkAtRules("keyframes", (frames) => {
  frames.walkDecls((declaration) => {
    if (!declaration.prop.startsWith("--")) return;
    WRITING.set(declaration.prop, [...(WRITING.get(declaration.prop) ?? []), frames.params]);
  });
});

/* Off the stylesheet rather than written here: the room a layer's clip leaves is only enough against the
   outline a focused control really draws, which is the base rule every `[tabindex]` takes. */
const OUTLINE_REACH = ((): number => {
  const reaches: number[] = [];
  compiled.root.walkRules((rule) => {
    if (!rule.selectors.includes("[tabindex]:focus-visible")) return;
    const outline = rule.nodes.find((node) => node.type === "decl" && node.prop === "outline");
    const offset = rule.nodes.find((node) => node.type === "decl" && node.prop === "outline-offset");
    if (outline?.type !== "decl" || offset?.type !== "decl") return;
    reaches.push(parseFloat(outline.value) + parseFloat(offset.value));
  });
  assert.equal(reaches.length, 1, `${String(reaches.length)} rules draw a focused control's outline`);

  return reaches[0]!;
})();

/* A Tailwind `animate-` utility declares the theme variable and never the keyframes, so the name an
   animation runs is one substitution below the rule. */
const fromTheme = (value: string): string => value.replace(/var\((--[a-z-]+)\)/g, (_whole, name: string) => THEME[name] ?? "");

/* Empty for a marker class rather than a failure: `group` and `peer` declare nothing, and a utility
   the stylesheet really lost is caught by the floors below, where the finding names the property. */
const rulesFor = (className: string): Compiled[] => RULES.get(className) ?? [];

/**
 * A combinator outside every `:has()` is a demand on something the element does not contain. The
 * region is the outermost element this component renders, so a rule making one can never match.
 */
function reachesOutside(selector: string): boolean {
  const open: string[] = [];
  let pending = "";

  for (let at = 0; at < selector.length; at++) {
    const character = selector[at]!;
    if (character === "\\") {
      at++;
      pending = "";
      continue;
    }

    if (character === "(") {
      open.push(pending);
      pending = "";
      continue;
    }
    if (character === ")") {
      open.pop();
      pending = "";
      continue;
    }
    if (character === ",") {
      // The whitespace a selector list puts after its comma parts two subjects rather than two elements.
      while (at + 1 < selector.length && selector[at + 1] === " ") at++;
      pending = "";
      continue;
    }

    if (" >+~".includes(character)) {
      if (!open.includes("has")) return true;
      pending = "";
      continue;
    }

    pending = character === ":" ? "" : pending + character;
  }

  return false;
}

/** The document root declares no `font-size`, so a rem here is the browser's own. */
const REM = 16;

/** The ceiling a released layer carries, which is a stand-in for none rather than a height anything was measured at. */
const NO_CEILING = 100000;

/** No runner here lays anything out, so arithmetic over the declared lengths is how a case reads the clamps. */
function lengthPx(value: string, variables: Readonly<Record<string, string>>): number {
  let resolved = value;
  for (let depth = 0; resolved.includes("var(") && depth < 4; depth++)
    resolved = resolved.replace(/var\((--[a-z-]+)\)/g, (_whole, name: string) => {
      const known = variables[name] ?? THEME[name];
      assert.ok(known !== undefined, `${value} reads ${name}, which neither the region nor the theme declares`);

      return known;
    });

  const converted = resolved
    .replace(/calc/g, "")
    .replace(/(\d+(?:\.\d+)?)(rem|px)/g, (_whole, size: string, unit: string) => String(Number(size) * (unit === "rem" ? REM : 1)));
  // A unit left standing here is dropped by the tokeniser below and its number read bare, so
  // `100%` answers a hundred and the case reading it fails naming the wrong property.
  const stray = /\d\s*(%|[A-Za-z]+)/.exec(converted);
  assert.ok(stray === null, `${value} is measured in ${String(stray?.[1])}, which this arithmetic cannot resolve`);

  const tokens = converted.match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? [];

  let at = 0;
  const factor = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = sum();
      at++;
      return inner;
    }
    if (token === "-") return -factor();

    return Number(token);
  };
  const product = (): number => {
    let left = factor();
    while (tokens[at] === "*" || tokens[at] === "/") left = tokens[at++] === "*" ? left * factor() : left / factor();

    return left;
  };
  const sum = (): number => {
    let left = product();
    while (tokens[at] === "+" || tokens[at] === "-") left = tokens[at++] === "+" ? left + product() : left - product();

    return left;
  };

  return sum();
}

type Row = { id: string };

const ROWS: Row[] = [{ id: "eins" }, { id: "zwei" }];

const SEARCH_KEYS = ["id"] as const;

const FACETS: readonly Facet<Row>[] = [
  { param: "besetzung", label: "Besetzung", options: [{ value: "leer", label: "Keine" }], read: () => ["leer"] },
];

/** The slot each shape really fills: `"table"` alone is the react-aria collection that grows a `tbody`. */
const slotFor = (shape: AdminCrudShape, rows: Row[]) =>
  shape === "table"
    ? h(
        "table",
        null,
        h(
          "tbody",
          null,
          rows.map((row) => h("tr", { key: row.id }, h("td", null, row.id))),
        ),
      )
    : h(
        "ul",
        null,
        rows.map((row) => h("li", { key: row.id }, row.id)),
      );

type Mounted = { shape: AdminCrudShape; hasFacets: boolean; commits?: boolean };

const regionOf = ({ shape, hasFacets, commits = true }: Mounted): ReactNode =>
  h(AdminCrudView<Row>, {
    items: ROWS,
    searchKeys: SEARCH_KEYS,
    facets: hasFacets ? FACETS : [],
    shape: shape,
    renderTable: ({ filteredItems }) => (commits ? slotFor(shape, filteredItems) : null),
  });

const underRoute = (tree: ReactNode): ReactNode => underNext(tree, { pathname: "/admin/spieler" });

const render = (mounted: Mounted): string => renderTree(underRoute(regionOf(mounted)));

/** The region where a route puts it: inside the shell, which is what writes the variable it reads. */
const renderUnderShell = (mounted: Mounted): string => renderTree(underRoute(h(AdminCrudShell, { search: null, children: regionOf(mounted) })));

/** The region is the outermost element of the render, and the only element carrying the box. */
function regionClasses(html: string): string[] {
  const opening = /^<div class="([^"]*)"/.exec(html);
  assert.ok(opening !== null, `the render opens on something other than the region: ${html.slice(0, 120)}`);

  return opening[1]!.split(/\s+/).filter(Boolean);
}

/** The classes of the element opening at `at`. */
function classesAt(html: string, at: number): string[] {
  const found = /^<[a-z][\w-]*\s[^>]*?class="([^"]*)"/.exec(html.slice(at));
  assert.ok(found !== null, `the element at ${String(at)} carries no class`);

  return found[1]!.split(/\s+/).filter(Boolean);
}

/** The utility nothing but the cover wears, which is what finds it without trusting its place in the markup. */
const COVER = "opacity-(--admin-region-held)";

const coverClasses = (html: string): string[] => classesAt(html, opensCarrying(html, COVER));

/** Where the content layer opens: the region's first child, which is the layer the rows and the bar sit in. */
const contentOpens = (html: string): number => html.indexOf(">") + 1;

const contentClasses = (html: string): string[] => classesAt(html, contentOpens(html));

/** Every class anywhere in a render: the element running the hold is not the region, so `regionClasses` cannot reach it. */
const classesIn = (html: string): string[] => [...new Set([...html.matchAll(/ class="([^"]*)"/g)].flatMap((found) => found[1]!.split(/\s+/)))];

/** Where the markup opens the element carrying `className`. */
function opensCarrying(html: string, className: string): number {
  for (const opening of html.matchAll(/<[a-z][\w-]*\s[^>]*?class="([^"]*)"/g))
    if (opening[1]!.split(/\s+/).includes(className)) return opening.index;

  return assert.fail(`nothing in the render carries ${className}`);
}

/** Where the element opening at `at` closes, counted over its own tag's opens and closes. */
function closesAfter(html: string, at: number): number {
  const tag = /^<([a-z][\w-]*)/.exec(html.slice(at))?.[1];
  assert.ok(tag !== undefined, `the markup opens no element at ${String(at)}`);

  const step = new RegExp(`</?${tag}(?=[\\s/>])`, "g");
  step.lastIndex = at;

  let depth = 0;
  for (let found = step.exec(html); found !== null; found = step.exec(html)) {
    depth += found[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return found.index;
  }

  return assert.fail(`the ${tag} opening at ${String(at)} never closes`);
}

type Band = "narrow" | "wide";

/** What an element's classes leave a property at with nothing gating them, the wide band taking the banded rule. */
function settled(classes: readonly string[], property: string, band: Band): string {
  let value: string | null = null;

  for (const className of classes)
    for (const rule of rulesFor(className)) {
      if (rule.gated || (rule.banded && band === "narrow")) continue;
      const declared = rule.declarations.get(property);
      if (declared !== undefined) value = declared;
    }

  assert.ok(value !== null, `nothing among ${classes.join(" ")} declares ${property}`);

  return value;
}

/** Every value the classes leave a property at, banded and gated rules included: `settled` answers the winner, this answers the field. */
function declared(classes: readonly string[], property: string): string[] {
  return classes.flatMap(rulesFor).flatMap((rule) => {
    const value = rule.declarations.get(property);

    return value === undefined ? [] : [value];
  });
}

describe("the box an admin CRUD region holds", () => {
  /* A class on the region proves nothing on its own: what decides the box is the rule Tailwind
     compiles it to. A `group-` variant compiles to a descendant selector, and the region is the group. */
  it("takes the box and the cover over it from inside the region, which is the element carrying both", () => {
    const THE_BOX = ["max-height", "overflow", "opacity", "position", "display", "grid-row-start", "grid-column-start", "--admin-region-held"];

    for (const shape of SHAPES) {
      const html = render({ shape, hasFacets: true });
      const deciding = [...regionClasses(html), ...contentClasses(html), ...coverClasses(html)].filter((className) =>
        rulesFor(className).some((rule) => THE_BOX.some((property) => rule.declarations.has(property))),
      );

      assert.ok(deciding.length >= THE_BOX.length, `${shape}: ${String(deciding.length)} classes decide the box and its cover`);

      for (const className of deciding)
        for (const rule of rulesFor(className))
          assert.ok(!reachesOutside(rule.selector), `${shape}: ${className} compiles to ${rule.selector}, which is a demand on an ancestor`);
    }
  });

  it("scales the cover over it by the same variable the layers are clamped on", () => {
    for (const shape of SHAPES) {
      const opacity = settled(coverClasses(render({ shape, hasFacets: true })), "opacity", "wide");

      assert.equal(lengthPx(opacity, { "--admin-region-held": "1" }), 1, `${shape}: the cover is not opaque while the box is held`);
      assert.equal(lengthPx(opacity, { "--admin-region-held": "0" }), 0, `${shape}: the cover survives the box it covers`);
    }
  });

  /* Markup order decides paint only within one paint layer. A cover left in flow paints beneath every
     positioned box the content holds — HeroUI's table root, each `Button`, a filter pill's scroller. */
  it("positions the cover, so the rows' positioned boxes paint beneath it rather than over it", () => {
    for (const shape of SHAPES)
      for (const band of ["narrow", "wide"] as const) {
        const position = settled(coverClasses(render({ shape, hasFacets: true })), "position", band);

        assert.notEqual(position, "static", `${shape} at ${band}: the cover is in flow, under every positioned box in the content`);
      }
  });

  /* A clamped layer is laid out whole, so what lies past its clamp is clipped or on the page. A clip at the
     region would take the outline and shadow of any box flush with its edge. */
  it("clips each layer at its own edge, an outline's reach outside its content, and never the region", () => {
    for (const shape of SHAPES) {
      const html = render({ shape, hasFacets: true });
      assert.deepEqual(declared(regionClasses(html), "overflow"), [], `${shape}: the region clips what its layers draw`);

      for (const [which, classes] of [
        ["the content", contentClasses(html)],
        ["the cover", coverClasses(html)],
      ] as const)
        for (const band of ["narrow", "wide"] as const) {
          assert.equal(settled(classes, "overflow", band), "clip", `${shape} at ${band}: ${which} is not clipped at its own edge`);

          const room = lengthPx(settled(classes, "padding", band), {});
          assert.ok(room >= OUTLINE_REACH, `${shape} at ${band}: ${which} leaves ${String(room)}px for a ${String(OUTLINE_REACH)}px outline`);
          assert.equal(lengthPx(settled(classes, "margin", band), {}), -room, `${shape} at ${band}: ${which} sits elsewhere than its cell`);
        }
    }
  });

  /* One cell is what makes the region as tall as whichever layer is measuring it. Two cells, or a
     third child taking a row of its own, and the region is the sum instead. */
  it("stacks the cover over the content in one cell, and holds nothing else in it", () => {
    for (const shape of SHAPES) {
      const html = render({ shape, hasFacets: true });

      assert.equal(settled(regionClasses(html), "display", "wide"), "grid", `${shape}: the region is not a grid`);

      for (const [which, classes] of [
        ["the content", contentClasses(html)],
        ["the cover", coverClasses(html)],
      ] as const) {
        assert.equal(settled(classes, "grid-row-start", "wide"), "1", `${shape}: ${which} starts on a row of its own`);
        assert.equal(settled(classes, "grid-column-start", "wide"), "1", `${shape}: ${which} starts in a column of its own`);
      }

      const closes = closesAfter(html, contentOpens(html));
      assert.equal(opensCarrying(html, COVER), closes + "</div>".length, `${shape}: the cover does not open where the content closes`);
      assert.equal(
        closesAfter(html, opensCarrying(html, COVER)),
        html.length - "</div></div>".length,
        `${shape}: the cover is not the region's last child`,
      );
    }
  });

  /* The layer that is not clamped away is the one the cell is sized from, so the box follows
     whatever the placeholder grows to rather than a height written down. */
  it("is measured by the cover while the box is held and by its own content once released", () => {
    for (const shape of SHAPES) {
      const html = render({ shape, hasFacets: true });
      const layers = { cover: coverClasses(html), content: contentClasses(html) };

      for (const band of ["narrow", "wide"] as const) {
        const ceiling = (which: keyof typeof layers, held: string): number =>
          lengthPx(settled(layers[which], "max-height", band), { "--admin-region-held": held });

        assert.equal(ceiling("content", "1"), 0, `${shape} at ${band}: the content measures the region while it is held`);
        assert.ok(ceiling("cover", "1") >= NO_CEILING, `${shape} at ${band}: the held cover is capped at ${String(ceiling("cover", "1"))}px`);
        assert.equal(ceiling("cover", "0"), 0, `${shape} at ${band}: the cover measures the region after it is released`);
        assert.ok(
          ceiling("content", "0") >= NO_CEILING,
          `${shape} at ${band}: the released content is capped at ${String(ceiling("content", "0"))}px`,
        );
      }
    }
  });

  /* What refuses a height read in a browser and carried here by hand: every one the region and its
     two layers declare is nothing or no ceiling, and a figure between the two is a measurement. */
  it("declares no height between nothing and no ceiling, at either end of the hold", () => {
    const THE_AXIS = ["height", "min-height", "max-height"];

    for (const shape of SHAPES) {
      const html = render({ shape, hasFacets: true });
      const elements = { region: regionClasses(html), content: contentClasses(html), cover: coverClasses(html) };

      let found = 0;
      for (const [where, classes] of Object.entries(elements))
        for (const property of THE_AXIS)
          for (const value of declared(classes, property)) {
            found += 1;

            for (const held of ["1", "0"]) {
              const px = lengthPx(value, { "--admin-region-held": held });
              assert.ok(px === 0 || px >= NO_CEILING, `${shape}: ${where} declares a ${property} of ${String(px)}px at a hold of ${held}`);
            }
          }

      assert.equal(found, 2, `${shape}: ${String(found)} declarations decide the region's height rather than the two clamps`);
    }
  });

  /* `has-[tbody]` opens only for a slot that commits one; the two card shapes commit none, so the
     same gate over either would hold its box for the life of the page. */
  it("waits for a tbody only where the slot commits one, and on the clock alone where none can arrive", () => {
    for (const shape of SHAPES) {
      const html = render({ shape, hasFacets: true });
      const gates = regionClasses(html)
        .flatMap(rulesFor)
        .filter((rule) => rule.declarations.get("--admin-region-held")?.includes("--admin-placeholder-hold") === true)
        .map((rule) => rule.selector);

      assert.equal(gates.length, 1, `${shape}: ${String(gates.length)} rules release the box`);

      const gate = gates[0]!;
      const commits = html.includes("<tbody");

      assert.equal(gate.includes(":has("), commits, `${shape}: ${gate} is gated on rows the slot ${commits ? "commits" : "never commits"}`);
      if (commits) assert.ok(gate.includes("tbody"), `${shape}: ${gate} waits for something other than the rows`);
    }
  });

  it("draws the placeholder its own box was sized for", () => {
    for (const shape of SHAPES)
      for (const hasFacets of [true, false]) {
        const html = render({ shape, hasFacets });

        assert.ok(
          html.includes(renderMarkup(AdminCrudFallback, { shape, hasFacets })),
          `${shape}/${String(hasFacets)}: the overlay draws something else`,
        );

        for (const other of SHAPES)
          if (other !== shape)
            assert.ok(
              !html.includes(renderMarkup(AdminCrudFallback, { shape: other, hasFacets })),
              `${shape}: the overlay also draws ${other}`,
            );
      }
  });

  /* React-aria writes its rows at commit, so the pass that mounts the collection leaves the region
     with no `tbody` at all — the state the unconditional arm of the hold is there for. */
  it("holds the box through the pass that commits no rows", () => {
    const first = render({ shape: "table", hasFacets: true, commits: false });

    assert.ok(!first.includes("<tbody"), "the slot commits rows after all, and this case proves nothing");
    assert.equal(settled(regionClasses(first), "--admin-region-held", "wide"), "1", "a region with no rows in it releases the box");
  });
});

/* The variable a region scales by is declared on the region and written nowhere the region renders:
   the animation writing it sits in a component the region has no way to see. */
describe("the hold every admin CRUD region reads", () => {
  it("is run by an animation on an element the region sits inside", () => {
    const waits = new Set(
      SHAPES.flatMap((shape) => regionClasses(render({ shape, hasFacets: true })))
        .flatMap(rulesFor)
        .flatMap((rule) => [...(rule.declarations.get("--admin-region-held") ?? "").matchAll(/var\((--[a-z-]+)\)/g)])
        .map((found) => found[1]!),
    );
    assert.equal(waits.size, 1, `the region waits on ${String(waits.size)} variables rather than one`);

    const frames = WRITING.get([...waits][0]!) ?? [];
    assert.equal(frames.length, 1, `${String(frames.length)} keyframes write ${[...waits][0]!}`);

    for (const shape of SHAPES) {
      const html = renderUnderShell({ shape, hasFacets: true });
      const running = classesIn(html).filter((className) =>
        rulesFor(className).some((rule) =>
          fromTheme(rule.declarations.get("animation") ?? "")
            .split(/\s+/)
            .includes(frames[0]!),
        ),
      );
      assert.equal(running.length, 1, `${shape}: ${String(running.length)} classes over the region run ${frames[0]!}`);

      const mark = regionClasses(render({ shape, hasFacets: true })).find((className) =>
        rulesFor(className).some((rule) => rule.declarations.has("--admin-region-held")),
      );
      assert.ok(mark !== undefined, `${shape}: the region declares the hold through no class`);

      const runs = opensCarrying(html, running[0]!);
      const region = opensCarrying(html, mark);
      assert.ok(runs < region && region < closesAfter(html, runs), `${shape}: the region sits outside the element running ${frames[0]!}`);
    }
  });
});

/* A route's loading boundary is replaced by its page whole, so whatever the page's shell draws around the
   list and the loading boundary does not is how far the list moves when the page arrives. */
describe("the placeholder a list route draws while its page loads", () => {
  it("stands inside the page's own shell, under a search row as tall as the bar that replaces it", () => {
    const chrome = renderMarkup(AdminCrudShell, { search: null, children: null }).replace(/(<\/div>)+$/, "");
    const bar = renderMarkup(SearchBar, { label: "Suchen", placeholder: "Suchen", value: "", onChange: () => undefined });
    const group = classesAt(bar, opensCarrying(bar, "lg:h-15"));

    for (const shape of SHAPES)
      for (const hasFacets of [true, false]) {
        const html = renderMarkup(AdminCrudLoading, { shape, hasFacets });

        assert.ok(html.startsWith(chrome), `${shape}/${String(hasFacets)}: the placeholder stands outside the page's shell`);
        assert.ok(
          html.includes(renderMarkup(AdminCrudFallback, { shape, hasFacets })),
          `${shape}/${String(hasFacets)}: it draws another placeholder`,
        );

        const search = classesAt(html, chrome.length);
        for (const band of ["narrow", "wide"] as const)
          assert.equal(settled(search, "height", band), settled(group, "height", band), `${shape} at ${band}: the search row changes height`);
      }
  });

  /* The bar takes what a trigger beside it leaves, and the trigger is as wide as its words: a placeholder bar
     spanning the row, or standing beside a box of another width, moves when the page arrives. */
  it("draws the loaded bar's width, and beside a trigger a box of the trigger's own recipe", async () => {
    const { AdminCrudSearch } = await import("./AdminCrudSearch.tsx");
    const { Button } = await import("@heroui/react/button");
    const { formButton } = await import("./formButtons.ts");

    const loadedBar = (attachEnd: boolean): string[] =>
      classesAt(renderTree(underNext(h(AdminCrudSearch, { searchLabel: "Suchen", searchPlaceholder: "Suchen", attachEnd }))), 0);
    const WIDTH = ["width", "min-width", "max-width", "flex"] as const;
    const widthOf = (classes: readonly string[]) => WIDTH.map((property) => [property, declared(classes, property)]);

    const chrome = renderMarkup(AdminCrudShell, { search: null, children: null }).replace(/(<\/div>)+$/, "");
    const ohne = renderMarkup(AdminCrudLoading, {});
    const mit = renderMarkup(AdminCrudLoading, { createLabel: "Neu anlegen" });

    // Before the comparisons read as agreement: two bars declaring no width at all would agree too.
    assert.ok(
      WIDTH.some((property) => declared(loadedBar(true), property).length > 0),
      "the loaded bar declares no width at all",
    );
    assert.deepEqual(
      widthOf(classesAt(ohne, chrome.length)),
      widthOf(loadedBar(false)),
      "the bar with no trigger beside it is drawn another width",
    );
    assert.deepEqual(widthOf(classesAt(mit, chrome.length)), widthOf(loadedBar(true)), "the bar beside a trigger is drawn another width");

    // HeroUI's own half included: its rule pulls a trigger's glyph in at both sides, which a box of the recipe alone misses.
    const trigger = classesAt(renderTree(h(Button, { className: formButton({ intent: "trigger" }) }, "Neu anlegen")), 0);
    const drawn = /<div aria-hidden="true" class="([^"]*)">([\s\S]*?)<\/div>/.exec(mit.slice(chrome.length));
    assert.ok(drawn !== null, "the placeholder beside a trigger draws no trigger box");
    assert.deepEqual(
      drawn[1]!.split(/\s+/).filter((className) => className !== "invisible"),
      trigger,
      "the trigger's box is drawn from classes the trigger does not wear",
    );
    assert.equal(textOf(drawn[2]!).trim(), "Neu anlegen", "the trigger's box is sized by words other than the ones it was handed");
    assert.ok(!ohne.includes('aria-hidden="true" class="button'), "a row whose page passes no trigger draws a trigger's box");
  });
});

/* No utility in the tree reaches outside the element it sits on, so the tree alone cannot tell this
   reader from one that answers false to everything. */
describe("the reader behind the ancestor sweep", () => {
  it("takes a rule reaching above the element and leaves one reaching into it", () => {
    const upward = rulesFor(REACHES_UPWARD);

    assert.equal(upward.length, 1, `the stylesheet compiles ${String(upward.length)} rules for the inlined candidate`);
    assert.ok(reachesOutside(upward[0]!.selector), `${upward[0]!.selector}: read as reaching no further than the element`);

    for (const selector of [".a:has(:is(tbody))", ".a", ".a:has(> tbody)", ".a\\:b\\+c", ".a, .b"])
      assert.ok(!reachesOutside(selector), `${selector}: read as a demand on an ancestor`);

    for (const selector of [".a .b", ".a > .b", ".a + .b", ".a:is(:where(.g) *)"])
      assert.ok(reachesOutside(selector), `${selector}: read as reaching no further than the element`);
  });
});

/* Every box claim above is this arithmetic's, so a length it reads wrongly fails a case naming a
   property that is fine. */
describe("the arithmetic behind the box claims", () => {
  it("refuses a length in a unit it cannot resolve, and reckons the ones it can", () => {
    assert.equal(lengthPx("calc(2rem + 4px)", {}), 36);
    assert.equal(lengthPx("var(--probe)", { "--probe": "1.5rem" }), 24);
    assert.throws(() => lengthPx("100%", {}), /measured in %/);
    assert.throws(() => lengthPx("4vh", {}), /measured in vh/);
  });
});

const ADMIN = path.join(SRC, "app", "admin");
const VIEWS = path.join(SRC, "features");

const parse = async (file: string): Promise<ts.SourceFile> =>
  ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/* Selected on the fallback each route draws, which is neither of the properties the two cases below
   assert: a route that stops satisfying either stays in the roster and fails inside it. */
const ROUTES: string[] = [];
for (const entry of await readdir(ADMIN, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const page = await parse(path.join(ADMIN, entry.name, "page.tsx")).catch(() => null);
  if (page?.text.includes("AdminCrudFallback") === true) ROUTES.push(entry.name);
}

type Element = { tag: string; attributes: Map<string, ts.JsxAttributeValue | undefined> };

function elementsOf(source: ts.SourceFile): Element[] {
  const found: Element[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
      for (const attribute of opening.attributes.properties)
        if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(source), attribute.initializer);

      found.push({ tag: opening.tagName.getText(source).replace(/<.*$/s, ""), attributes: attributes });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

type Drawn = { shape: string; hasFacets: boolean };

/** A shape nothing names is the prop's own default, which is what a route drawing a table passes. */
function drawnBy(element: Element, facetProp: string): Drawn {
  const shape = element.attributes.get("shape");
  const facets = element.attributes.get(facetProp);

  return {
    shape: shape !== undefined && ts.isStringLiteral(shape) ? shape.text : "table",
    hasFacets: facetProp === "facets" ? facets !== undefined : facets?.getText().includes("false") !== true,
  };
}

/** The element a page renders as the whole of its output, which everything it mounts sits under. */
function returnedBy(page: ts.SourceFile): string {
  const exported = page.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) === true,
  );
  assert.ok(exported?.body !== undefined, `${page.fileName}: exports no default function`);

  let returned = exported.body.statements.find(ts.isReturnStatement)?.expression;
  while (returned !== undefined && ts.isParenthesizedExpression(returned)) returned = returned.expression;
  assert.ok(
    returned !== undefined && (ts.isJsxElement(returned) || ts.isJsxSelfClosingElement(returned)),
    `${page.fileName}: returns no element`,
  );

  return (ts.isJsxElement(returned) ? returned.openingElement : returned).tagName.getText(page);
}

function oneElement(elements: readonly Element[], tag: string, file: string): Element {
  const matching = elements.filter((element) => element.tag === tag);
  assert.equal(matching.length, 1, `${file}: holds ${String(matching.length)} ${tag} elements`);

  return matching[0]!;
}

/* The wiring between a route's own fallback and the view under it: two files, and no render of
   either shows what the other draws. */
describe("every admin CRUD route", () => {
  it("draws one shape and one facet state from its own fallback down to its view", async () => {
    assert.ok(ROUTES.length > 0, "no admin route draws the shared fallback");

    /* Derived twice, by two routes that must agree (`docs/frontend/spec.md` §1.9): a view reached
       only through its own page would drop out of the roster rather than fail against it. */
    const rendering = filesUnder(VIEWS, (name) => name.endsWith("View.tsx") && !isTestFile(name), 20)
      .filter((file) => readFileSync(file, "utf8").includes("<AdminCrudView"))
      .map((file) => file.split(path.sep).join("/"));
    assert.equal(
      ROUTES.length,
      rendering.length,
      `${String(ROUTES.length)} routes draw the placeholder, ${String(rendering.length)} views hold it`,
    );

    const reached: string[] = [];
    for (const route of ROUTES) {
      const page = await parse(path.join(ADMIN, route, "page.tsx"));
      const loading = await parse(path.join(ADMIN, route, "loading.tsx"));

      const viewName = elementsOf(page).find((element) => /^Admin\w+View$/.test(element.tag))?.tag;
      assert.ok(viewName !== undefined, `${route}: its page renders no admin view`);

      const specifier = page.statements
        .filter(ts.isImportDeclaration)
        .find((statement) => statement.getText(page).includes(viewName))
        ?.moduleSpecifier.getText(page)
        .replaceAll('"', "");
      assert.ok(specifier?.startsWith("@/features/") === true, `${route}: ${viewName} comes from ${String(specifier)}`);

      const view = await parse(path.join(SRC, `${specifier.slice("@/".length)}.tsx`));
      reached.push(view.fileName);

      const drawn = drawnBy(oneElement(elementsOf(page), "AdminCrudFallback", `${route}/page.tsx`), "hasFacets");

      assert.deepEqual(drawnBy(oneElement(elementsOf(loading), "AdminCrudLoading", `${route}/loading.tsx`), "hasFacets"), drawn);
      assert.deepEqual(drawnBy(oneElement(elementsOf(view), "AdminCrudView", specifier), "facets"), drawn, `${route}: ${viewName} disagrees`);
    }

    assert.deepEqual(reached.sort(), rendering.sort(), "a view holding the region sits under no route that draws its placeholder");
  });

  /* The wiring between a route's fallback and its page: a trigger's box drawn where the shell passes none, or
     missing where it passes one, moves the bar on arrival. Its words are
     `fl_frontend/src/features/admin/crudLoadingTriggers.test.ts`'s. */
  it("draws a trigger's box exactly where the page's shell passes a trigger", async () => {
    assert.ok(ROUTES.length > 0, "no admin route draws the shared fallback");

    for (const route of ROUTES) {
      const page = await parse(path.join(ADMIN, route, "page.tsx"));
      const loading = await parse(path.join(ADMIN, route, "loading.tsx"));

      const hasTrigger = oneElement(elementsOf(page), "AdminCrudShell", `${route}/page.tsx`).attributes.has("createModal");
      const attachEnd = oneElement(elementsOf(page), "AdminCrudSearch", `${route}/page.tsx`).attributes.get("attachEnd");

      assert.equal(
        oneElement(elementsOf(loading), "AdminCrudLoading", `${route}/loading.tsx`).attributes.has("createLabel"),
        hasTrigger,
        `${route}: its fallback and its page disagree on a trigger`,
      );
      assert.equal(attachEnd?.getText().includes("false") !== true, hasTrigger, `${route}: its bar joins a trigger its shell does not pass`);
    }
  });

  /* The shell is the only thing in the tree that runs the hold, and a region reaching no shell reads
     the property's own initial value instead: released from its first frame, with nothing failing. */
  it("returns the shell that runs the hold, so every region it mounts inherits one", async () => {
    assert.ok(ROUTES.length > 0, "no admin route draws the shared fallback");

    for (const route of ROUTES) {
      const page = await parse(path.join(ADMIN, route, "page.tsx"));
      assert.equal(returnedBy(page), "AdminCrudShell", `${route}: its page returns something else`);

      const specifier = page.statements
        .filter(ts.isImportDeclaration)
        .find((statement) => statement.getText(page).includes("AdminCrudShell"))
        ?.moduleSpecifier.getText(page)
        .replaceAll('"', "");
      assert.equal(specifier, "@/shared/components/ui/AdminCrudShell", `${route}: its shell comes from ${String(specifier)}`);
    }
  });
});
