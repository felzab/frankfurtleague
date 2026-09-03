import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderMarkup } from "@/shared/testing/renderTest";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension (`docs/frontend/spec.md` §1.9).
*/
const { RowActionDelete, RowActionRestore } = await import("./RowActions.tsx");

/** Whitespace-collapsed, the props block below being wrapped by the formatter rather than by hand. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "RowActions.tsx"), "utf8").replace(/\s+/g, " ");

const GRUND = "Die Saison ist gesperrt";

/** The two actions carrying a refusal, with the hover fill that separates the destructive one. */
const AKTIONEN: { name: string; Aktion: typeof RowActionRestore; label: string; ariaLabel: string; hover: string }[] = [
  {
    name: "the restore",
    Aktion: RowActionRestore,
    label: "Reaktivieren",
    ariaLabel: "Lessing-Kolleg reaktivieren",
    hover: "data-hovered:bg-hover",
  },
  {
    name: "the delete",
    Aktion: RowActionDelete,
    label: "Stilllegen",
    ariaLabel: "Lessing-Kolleg stilllegen",
    hover: "data-hovered:bg-hover-danger",
  },
];

type Aktion = (typeof AKTIONEN)[number];

/** The action as a list renders it once the endpoint's refusal is already known. */
const verweigert = (row: Aktion): string =>
  renderMarkup(row.Aktion, { label: row.label, ariaLabel: row.ariaLabel, onPress: () => undefined, disabledReason: GRUND });

/** The same action from a list passing no reason at all, which is what most call sites are. */
const angeboten = (row: Aktion): string => renderMarkup(row.Aktion, { label: row.label, ariaLabel: row.ariaLabel, onPress: () => undefined });

/** The control alone: what a press lands on, and what `disabled` closes. */
const knopf = (html: string): string => /<button\b[^>]*>/.exec(html)?.[0] ?? "";

/** Every accessible name the row emits, in document order — the wrapper's before the control's. */
const namen = (html: string): string[] => [...html.matchAll(/aria-label="([^"]*)"/g)].map((treffer) => treffer[1]!);

describe("a row action the endpoint already refuses", () => {
  /* First: every case below reads a `<button>` out of the markup, and a component that rendered
     nothing would leave each of them comparing against an empty string. */
  it("renders a control in both states", () => {
    for (const row of AKTIONEN) {
      assert.match(knopf(verweigert(row)), /^<button /, `${row.name} renders no control while refused`);
      assert.match(knopf(angeboten(row)), /^<button /, `${row.name} renders no control while offered`);
    }
  });

  /* The reason IS the gate rather than a boolean beside it, so no row can offer a press the write
     path already refuses — and none can close a press nothing refuses. */
  it("closes the control exactly while a reason stands", () => {
    for (const row of AKTIONEN) {
      assert.match(knopf(verweigert(row)), /\sdisabled=""/, `${row.name} stays pressable while its reason stands`);
      assert.doesNotMatch(knopf(angeboten(row)), /\sdisabled=""/, `${row.name} is closed on a row that passes no reason`);
    }
  });

  /* The refusal belongs to the wrapper: the control inside it is closed, so the wrapper's own name
     is the only thing a reader gets before pressing anything. */
  it("says the reason where a pointer can still reach it", () => {
    for (const row of AKTIONEN) {
      assert.deepEqual(namen(verweigert(row)), [GRUND, row.ariaLabel], `${row.name} does not announce its refusal on the wrapper`);
      assert.deepEqual(namen(angeboten(row)), [row.ariaLabel], `${row.name} announces a refusal on a row that has none`);
    }
  });

  /* The one silent half: a disabled control dispatches no pointer event and none reaches an ancestor
     either, so the wrapper above is the hit target only once this clears them. */
  it("makes the closed control transparent to the pointer", () => {
    for (const row of AKTIONEN) {
      assert.match(knopf(verweigert(row)), /\bdisabled:pointer-events-none\b/, `${row.name} swallows the press that should open its hint`);
    }
  });

  /* The delete is the destructive one and wears the tint that says so; the restore reverses a press
     rather than making one, and a row offering both must not stain them alike. */
  it("tints the destructive action apart from the one that undoes it", () => {
    for (const row of AKTIONEN) {
      const getragen = knopf(angeboten(row));
      // Anchored on both sides, so `bg-hover` is not read out of `bg-hover-danger`.
      const traegt = (fill: string): boolean => new RegExp(`\\b${fill}(?![\\w-])`).test(getragen);

      assert.deepEqual(
        AKTIONEN.filter((andere) => traegt(andere.hover)).map((andere) => andere.name),
        [row.name],
        `${row.name} wears a hover fill that is not its own`,
      );
    }
  });

  /* Read as text, optionality being erased before anything renders: most call sites pass no reason,
     and a required prop would put a compile error on every list whose action is never refused. */
  it("leaves the reason optional on both", () => {
    assert.equal(SOURCE.match(/disabledReason\?: string \| null;/g)?.length, AKTIONEN.length, "a row action's reason became required");
  });
});
