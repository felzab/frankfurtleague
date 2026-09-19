import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** `docs/frontend/spec.md` §1.20's rungs, declared once so no reader here can hold a ninth. */
const RUNGS = [0.5, 1, 2, 3, 4, 6, 8, 12];

/** Min-width order, which is what tells a responsive pair's two ends apart. */
const BREAKPOINTS = ["base", "sm", "md", "lg", "xl", "2xl"];

/** The two ends of each axis, in the spelling the exemptions below read. */
const EDGES = { top: "y", bottom: "y", start: "x", end: "x" } as const;
type Edge = keyof typeof EDGES;

const LEADING: Edge[] = ["top", "start"];

/** A side letter to the edges it sets. `s`/`e` are the logical pair; this app renders left to right. */
const SIDES: Record<string, Edge[]> = {
  "": ["top", "bottom", "start", "end"],
  t: ["top"],
  b: ["bottom"],
  l: ["start"],
  r: ["end"],
  s: ["start"],
  e: ["end"],
  x: ["start", "end"],
  y: ["top", "bottom"],
};

const GAP = /^gap(?:-([xy]))?-(.+)$/;
const SPACE = /^(-?)([mp])([trblsexy]?)-(.+)$/;

/** A class a child draws a box with, which makes its padding that box's inset rather than a gap. */
const DRAWS_A_BOX = /^(?:border|bg-|rounded|shadow|ring|outline|divide-)/;

type Token = { scope: string; breakpoint: string; base: string };

/**
 * A variant naming a breakpoint orders the declaration; every other variant selects a different
 * element, so two tokens pair only where the rest of their variants match.
 */
function parseToken(token: string): Token {
  const parts = token.split(":");
  const base = parts.pop() ?? "";
  const breakpoint = parts.find((variant) => BREAKPOINTS.includes(variant)) ?? "base";

  return { scope: parts.filter((variant) => !BREAKPOINTS.includes(variant)).join(":"), breakpoint, base };
}

const atOrBelow = (breakpoint: string): string[] => BREAKPOINTS.slice(0, BREAKPOINTS.indexOf(breakpoint) + 1);

/** The declaration a breakpoint inherits: the last one at or below it, which is the min-width cascade. */
function resolved<T>(declared: Map<string, T>, breakpoint: string): T | undefined {
  const reachable = atOrBelow(breakpoint).filter((step) => declared.has(step));
  const last = reachable.at(-1);

  return last === undefined ? undefined : declared.get(last);
}

/** The static halves of a class list, an interpolated constant contributing a break rather than its tokens. */
function classText(node: ts.Node | undefined): string {
  if (node === undefined) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return classText(node.expression);
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");

  return "";
}

const isInterpolated = (node: ts.Node | undefined): boolean =>
  node !== undefined && (ts.isTemplateExpression(node) || (ts.isJsxExpression(node) && isInterpolated(node.expression)));

function classAttribute(node: ts.JsxElement | ts.JsxSelfClosingElement, source: ts.SourceFile): ts.Node | undefined {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const found = opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className",
  );

  return found !== undefined && ts.isJsxAttribute(found) ? found.initializer : undefined;
}

const classesOf = (node: ts.Node | undefined): string[] => classText(node).split(/\s+/).filter(Boolean);

const files = filesUnder(SRC_DIR, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 450);

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const shown = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

/* Every string the tree writes, not the `className` attributes alone: a recipe module spells its
   class list as a plain literal, so a reader watching JSX would pass `formFieldStyles.ts :: FIELD_PAIR`
   and every `tv` slot without looking at them. */
function classListsIn(source: ts.SourceFile): { text: string; line: number }[] {
  const found: { text: string; line: number }[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      found.push({ text: classText(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

type GapToken = { where: string; token: string; parsed: Token; axes: string[]; value: string };

const gapTokens: GapToken[] = [];
const filesWithAGap = new Set<string>();

for (const file of files) {
  for (const list of classListsIn(parse(file))) {
    for (const token of list.text.split(/\s+/).filter(Boolean)) {
      const parsed = parseToken(token);
      const match = GAP.exec(parsed.base);
      if (match === null) continue;

      const [, axis, value = ""] = match;
      gapTokens.push({
        where: `${shown(file)}:${String(list.line)}`,
        token,
        parsed,
        axes: axis === undefined ? ["x", "y"] : [axis],
        value,
      });
      filesWithAGap.add(file);
    }
  }
}

describe("every gap the tree writes", () => {
  /* A floor over both listings: the files come from the walk, and the tokens from reading them, so a
     reader that went blind on the class lists fails here rather than passing over nothing. */
  it("is found by the sweep, in recipe modules as well as in markup", () => {
    assert.ok(gapTokens.length >= 400, `the sweep read ${String(gapTokens.length)} gap tokens, far under what the tree writes`);
    assert.ok(filesWithAGap.size >= 120, `only ${String(filesWithAGap.size)} files yielded a gap token`);

    const recipes = [...filesWithAGap].filter((file) => file.endsWith(".ts"));
    assert.ok(recipes.length > 0, "no `.ts` recipe module was read, so every `tv` slot and class constant went unswept");
  });

  it("stands on one of the eight rungs, or is the absence of a gap", () => {
    for (const { where, token, value } of gapTokens) {
      assert.ok(
        value === "0" || RUNGS.includes(Number(value)),
        `${where}: \`${token}\` is off §1.20's ladder — a gap is one of ${RUNGS.join(" ")}, or \`0\` for no gap at all`,
      );
    }
  });
});

/** The declared values of one axis of one class list, keyed by the breakpoint each was declared at. */
type Series = Map<string, string>;

function seriesIn(tokens: GapToken[]): Map<string, Series> {
  const grouped = new Map<string, Series>();

  for (const gap of tokens) {
    for (const axis of gap.axes) {
      const key = `${gap.parsed.scope}|${axis}`;
      const series = grouped.get(key) ?? new Map<string, string>();
      series.set(gap.parsed.breakpoint, gap.value);
      grouped.set(key, series);
    }
  }

  return grouped;
}

describe("a responsive gap", () => {
  it("steps one rung, never two", () => {
    const byList = new Map<string, GapToken[]>();
    for (const gap of gapTokens) byList.set(gap.where, [...(byList.get(gap.where) ?? []), gap]);

    for (const [where, tokens] of byList) {
      for (const series of seriesIn(tokens).values()) {
        const declared = BREAKPOINTS.filter((step) => series.has(step)).map((step) => series.get(step) ?? "");

        for (let i = 0; i + 1 < declared.length; i += 1) {
          // `0` is the absence of a gap rather than a rung, so a breakpoint switching one off steps
          // from nowhere and there is no distance to measure.
          if (declared[i] === "0" || declared[i + 1] === "0") continue;

          const step = Math.abs(RUNGS.indexOf(Number(declared[i])) - RUNGS.indexOf(Number(declared[i + 1])));
          assert.equal(
            step,
            1,
            `${where}: \`${declared[i]}\` to \`${declared[i + 1]}\` skips a rung, which rescales the rhythm rather than stepping it`,
          );
        }
      }
    }
  });
});

type Box = { classes: string[]; interpolated: boolean };

/** Which axes carry a gap a reader can see: a column's column-gap and an unwrapped row's row-gap are inert. */
function liveAxes(parent: Box, breakpoint: string): Set<string> {
  const display = new Map<string, string>();
  const column = new Map<string, boolean>();
  const wraps = new Map<string, boolean>();

  for (const token of parent.classes) {
    const { breakpoint: step, scope, base } = parseToken(token);
    if (scope !== "") continue;
    if (base === "grid" || base === "inline-grid") display.set(step, "grid");
    if (base === "flex" || base === "inline-flex") display.set(step, "flex");
    if (base === "flex-col" || base === "flex-col-reverse") column.set(step, true);
    if (base === "flex-row" || base === "flex-row-reverse") column.set(step, false);
    if (base === "flex-wrap" || base === "flex-wrap-reverse") wraps.set(step, true);
    if (base === "flex-nowrap") wraps.set(step, false);
  }

  const shape = resolved(display, breakpoint);
  if (shape === "grid") return new Set(["x", "y"]);
  if (shape !== "flex") return new Set();
  if (resolved(wraps, breakpoint) === true) return new Set(["x", "y"]);

  return new Set([resolved(column, breakpoint) === true ? "y" : "x"]);
}

function gappedAxes(parent: Box, breakpoint: string): Set<string> {
  const declared = new Map<string, Map<string, string>>([
    ["x", new Map()],
    ["y", new Map()],
  ]);

  for (const token of parent.classes) {
    const parsed = parseToken(token);
    const match = GAP.exec(parsed.base);
    // A scoped gap selects a descendant rather than this element's own children.
    if (match === null || parsed.scope !== "") continue;

    const [, axis, value = ""] = match;
    for (const each of axis === undefined ? ["x", "y"] : [axis]) declared.get(each)?.set(parsed.breakpoint, value);
  }

  const live = liveAxes(parent, breakpoint);
  return new Set(
    [...live].filter((axis) => {
      const value = resolved(declared.get(axis) ?? new Map<string, string>(), breakpoint);
      return value !== undefined && value !== "0";
    }),
  );
}

/** The margin or padding standing on each edge of a child at one breakpoint, the cascade resolved. */
function spaceOn(child: Box, kind: string, breakpoint: string): Map<Edge, string> {
  const declared = new Map<Edge, Map<string, string>>([
    ["top", new Map()],
    ["bottom", new Map()],
    ["start", new Map()],
    ["end", new Map()],
  ]);

  for (const token of child.classes) {
    const parsed = parseToken(token);
    const match = SPACE.exec(parsed.base);
    if (match === null || parsed.scope !== "") continue;

    const [, sign = "", property, side = "", value = ""] = match;
    if (property !== kind) continue;

    // The sign rides with the value: a negative margin shortens the distance rather than
    // lengthening it, so a reader dropping the `-` names the one figure the box cannot render.
    for (const edge of SIDES[side] ?? []) declared.get(edge)?.set(parsed.breakpoint, `${sign}${value}`);
  }

  const standing = new Map<Edge, string>();
  for (const [edge, steps] of declared) {
    const value = resolved(steps, breakpoint);
    if (value !== undefined && value !== "0" && value !== "auto") standing.set(edge, value);
  }

  return standing;
}

const isElement = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);

/**
 * A child rendered behind a condition still lands in the parent's own flow, so an arm of a `&&` or a
 * ternary is one of the elements the gap parts.
 */
function layoutChildren(children: readonly ts.JsxChild[]): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];

  const take = (node: ts.Node | undefined): void => {
    if (node === undefined) return;
    if (isElement(node)) found.push(node);
    else if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) take(node.expression);
    else if (ts.isBinaryExpression(node)) take(node.right);
    else if (ts.isConditionalExpression(node)) {
      take(node.whenTrue);
      take(node.whenFalse);
    } else if (ts.isJsxFragment(node)) for (const nested of node.children) take(nested);
  };

  for (const child of children) take(child);
  return found;
}

/* Keyed on the edge rather than pushed per breakpoint: one class stands at every width at or above
   the one declaring it, and six copies of one finding bury the next one. */
const marginFindings = new Map<string, string>();
const paddingFindings = new Map<string, string>();
let gappedContainers = 0;

for (const file of files.filter((name) => name.endsWith(".tsx"))) {
  const source = parse(file);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const attribute = classAttribute(node, source);
      const parent: Box = { classes: classesOf(attribute), interpolated: isInterpolated(attribute) };
      const children = layoutChildren(node.children);
      const axesByStep = new Map(BREAKPOINTS.map((step) => [step, gappedAxes(parent, step)]));

      if ([...axesByStep.values()].some((axes) => axes.size > 0)) {
        gappedContainers += 1;

        children.forEach((node_, index) => {
          const childAttribute = classAttribute(node_, source);
          const child: Box = { classes: classesOf(childAttribute), interpolated: isInterpolated(childAttribute) };
          const opening = ts.isJsxElement(node_) ? node_.openingElement : node_;
          const where = `${shown(file)}:${String(source.getLineAndCharacterOfPosition(opening.getStart(source)).line + 1)}`;
          // A leading edge on the first child and a trailing edge on the last stand against the
          // container's own inset, where no sibling is on the other side of them.
          const against = (edge: Edge): boolean =>
            (LEADING.includes(edge) && index === 0) || (!LEADING.includes(edge) && index === children.length - 1);

          for (const step of BREAKPOINTS) {
            const axes = axesByStep.get(step) ?? new Set<string>();

            for (const [edge, value] of spaceOn(child, "m", step)) {
              if (!axes.has(EDGES[edge]) || against(edge)) continue;
              const key = `${where}|m|${edge}`;
              if (!marginFindings.has(key))
                marginFindings.set(key, `${where}: a \`${value}\` margin on the ${edge} edge, inside \`${parent.classes.join(" ")}\``);
            }

            // A padding inside a box a reader can see is that box's inset (§1.18), and an
            // interpolated recipe can be carrying the border that makes it one.
            if (child.interpolated || child.classes.some((name) => DRAWS_A_BOX.test(name))) continue;

            for (const [edge, value] of spaceOn(child, "p", step)) {
              if (!axes.has(EDGES[edge]) || against(edge)) continue;
              const key = `${where}|p|${edge}`;
              if (!paddingFindings.has(key))
                paddingFindings.set(key, `${where}: a \`${value}\` padding on the ${edge} edge, inside \`${parent.classes.join(" ")}\``);
            }
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
}

const report = (findings: Map<string, string>): string => [...findings.values()].join("\n");

describe("the distance between two siblings of a gapped box", () => {
  it("is measured over enough of the tree to catch one", () => {
    assert.ok(gappedContainers >= 100, `only ${String(gappedContainers)} gapped containers were read, so the sweep resolved almost nothing`);
  });

  /* A margin here composes with the gap, so the class list declares one rung while the reader sees
     another — which is exactly what the rung sweep above cannot see. */
  it("carries no margin of its own on the gap's axis", () => {
    assert.equal(marginFindings.size, 0, `a margin moves a gap off §1.20's ladder at the call site:\n${report(marginFindings)}`);
  });

  /* Padding on a child drawing no box is indistinguishable from a gap: there is no edge for it to
     inset content from, so the reader adds it to the rung. */
  it("carries no padding on that axis where it draws no box for the padding to inset", () => {
    assert.equal(paddingFindings.size, 0, `a padding on an invisible box reads as gap the ladder never granted:\n${report(paddingFindings)}`);
  });
});
