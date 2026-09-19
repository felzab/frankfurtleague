import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { refusalWrappers, renderMarkup } from "@/shared/testing/renderTest";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension.
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

  /* The refusal belongs to the overlay, the one stop over a closed control: it is named as the
     control, so speech input still finds the row's action, and describes the reason. */
  it("says the reason where a pointer and a keyboard can still reach it", () => {
    for (const row of AKTIONEN) {
      assert.deepEqual(
        refusalWrappers(verweigert(row)),
        [{ name: row.ariaLabel, label: row.ariaLabel, reason: GRUND }],
        `${row.name}'s wrapper is not named by its control, or does not describe its refusal`,
      );
      assert.deepEqual(namen(angeboten(row)), [row.ariaLabel], `${row.name} announces a refusal on a row that has none`);
      assert.ok(!angeboten(row).includes("aria-describedby"), `${row.name} describes a refusal on a row that has none`);
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

  /* A literal spelling ACTION_BUTTON_CLASS's classes renders identically, so the markup above
     cannot tell the shared constant from a copy of it that stops tracking. */
  it("dresses every icon control from a shared constant rather than a copy", () => {
    // Found by their own elements: counting the constant's uses is a population filtered on the very
    // property this asserts, so a control spelling the classes out drops out instead of failing.
    const kontrollen = [...SOURCE.matchAll(/<(?:Button|Link|Dropdown\.Trigger)\b[^>]*>/g)].map((treffer) => treffer[0]);

    // `Dropdown.Item` is outside this: a menu's rows are full-width and dressed at their own line.
    assert.equal(kontrollen.length, 5, `expected the five icon controls, found ${String(kontrollen.length)}`);
    for (const kontrolle of kontrollen) {
      assert.match(
        kontrolle,
        /className=\{(?:ACTION_BUTTON_CLASS|ACTION_LINK_CLASS|DANGER_CLASS)\}/,
        `an icon control is dressed by hand: ${kontrolle}`,
      );
    }
  });

  /* Read as text, optionality being erased before anything renders: most call sites pass no reason,
     and a required prop would put a compile error on every list whose action is never refused. */
  it("leaves the reason optional on both", () => {
    assert.equal(SOURCE.match(/disabledReason\?: string \| null;/g)?.length, AKTIONEN.length, "a row action's reason became required");
  });
});

describe("a restore whose write is already running", () => {
  const RESTORE = AKTIONEN[0]!;
  const props = { label: RESTORE.label, ariaLabel: RESTORE.ariaLabel, onPress: () => undefined };
  const laufend = renderMarkup(RowActionRestore, { ...props, isPending: true });
  const offen = renderMarkup(RowActionRestore, props);

  /* A second press would send the reactivation twice, the list only redrawing once the first returns. */
  it("takes no press while it runs, and every press once it has returned", () => {
    assert.match(knopf(laufend), /\saria-disabled="true"/, "the running restore is announced as a control that can be pressed");
    assert.match(knopf(laufend), /\sdata-pending="true"/, "the running restore still takes a press");
    assert.doesNotMatch(knopf(offen), /\saria-disabled=|\sdata-pending=/, "an idle restore is held as though its write were running");
  });

  /* `disabled` takes a button out of the tab order, which drops the keyboard's focus to the page in the
     middle of the press that started the write. */
  it("keeps the keyboard's focus where the press left it", () => {
    assert.doesNotMatch(knopf(laufend), /\sdisabled=""/, "the running restore leaves the tab order");
    assert.match(knopf(laufend), /\stabindex="0"/, "the running restore cannot be reached by the keyboard");
  });

  /* The refusal wrapper answers a reason, and a write in flight is none: swapping it in would remount the
     button under the keyboard's focus and describe a refusal nobody made. */
  it("keeps the wrapper it had before the press", () => {
    assert.ok(knopf(laufend) !== "" && knopf(offen) !== "", "a restore rendered no control, so the comparison below proves nothing");
    assert.equal(laufend.replace(knopf(laufend), ""), offen.replace(knopf(offen), ""), "the running restore is wrapped differently");
  });
});
