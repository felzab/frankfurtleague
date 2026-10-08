import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { refusalWrappers, renderMarkup } from "@/shared/testing/renderTest";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension.
*/
const { RowActionCopy, RowActionDelete, RowActionLink, RowActionMenu, RowActionRestore } = await import("./RowActions.tsx");

const REASON = "Die Saison ist gesperrt";

/** The two actions carrying a refusal, with the hover fill that separates the destructive one. */
const ACTIONS: { name: string; Action: typeof RowActionRestore; label: string; subject: string; named: string; hover: string }[] = [
  {
    name: "the restore",
    Action: RowActionRestore,
    label: "Reaktivieren",
    subject: "Lessing-Kolleg",
    named: "Reaktivieren: Lessing-Kolleg",
    hover: "data-hovered:bg-hover",
  },
  {
    name: "the delete",
    Action: RowActionDelete,
    label: "Stilllegen",
    subject: "Lessing-Kolleg",
    named: "Stilllegen: Lessing-Kolleg",
    hover: "data-hovered:bg-hover-danger",
  },
];

type Action = (typeof ACTIONS)[number];

/** The action as a list renders it once the endpoint's refusal is already known. */
const refused = (row: Action): string =>
  renderMarkup(row.Action, { label: row.label, subject: row.subject, onPress: () => undefined, disabledReason: REASON });

/** The same action from a list passing no reason at all, which is what most call sites are. */
const offered = (row: Action): string => renderMarkup(row.Action, { label: row.label, subject: row.subject, onPress: () => undefined });

/** The control alone: what a press lands on, and what `disabled` closes. */
const button = (html: string): string => /<button\b[^>]*>/.exec(html)?.[0] ?? "";

/** Every accessible name the row emits, in document order — the wrapper's before the control's. */
const names = (html: string): string[] => [...html.matchAll(/aria-label="([^"]*)"/g)].map((hit) => hit[1]!);

describe("a row action the endpoint already refuses", () => {
  /* First: every case below reads a `<button>` out of the markup, and a component that rendered
     nothing would leave each of them comparing against an empty string. */
  it("renders a control in both states", () => {
    for (const row of ACTIONS) {
      assert.match(button(refused(row)), /^<button /, `${row.name} renders no control while refused`);
      assert.match(button(offered(row)), /^<button /, `${row.name} renders no control while offered`);
    }
  });

  /* The reason IS the gate rather than a boolean beside it, so no row can offer a press the write
     path already refuses — and none can close a press nothing refuses. */
  it("closes the control exactly while a reason stands", () => {
    for (const row of ACTIONS) {
      assert.match(button(refused(row)), /\sdisabled=""/, `${row.name} stays pressable while its reason stands`);
      assert.doesNotMatch(button(offered(row)), /\sdisabled=""/, `${row.name} is closed on a row that passes no reason`);
    }
  });

  /* The refusal belongs to the overlay, the one stop over a closed control: it is named as the
     control, so speech input still finds the row's action, and describes the reason. */
  it("says the reason where a pointer and a keyboard can still reach it", () => {
    for (const row of ACTIONS) {
      assert.deepEqual(
        refusalWrappers(refused(row)),
        [{ name: row.named, label: row.named, reason: REASON }],
        `${row.name}'s wrapper is not named by its control, or does not describe its refusal`,
      );
      assert.deepEqual(names(offered(row)), [row.named], `${row.name} announces a refusal on a row that has none`);
      assert.ok(!offered(row).includes("aria-describedby"), `${row.name} describes a refusal on a row that has none`);
    }
  });

  /* The delete is the destructive one and wears the tint that says so; the restore reverses a press
     rather than making one, and a row offering both must not stain them alike. */
  it("tints the destructive action apart from the one that undoes it", () => {
    for (const row of ACTIONS) {
      const worn = button(offered(row));
      // Anchored on both sides, so `bg-hover` is not read out of `bg-hover-danger`.
      const carries = (fill: string): boolean => new RegExp(`\\b${fill}(?![\\w-])`).test(worn);

      assert.deepEqual(
        ACTIONS.filter((andere) => carries(andere.hover)).map((andere) => andere.name),
        [row.name],
        `${row.name} wears a hover fill that is not its own`,
      );
    }
  });
});

describe("a restore whose write is already running", () => {
  const RESTORE = ACTIONS[0]!;
  const props = { label: RESTORE.label, subject: RESTORE.subject, onPress: () => undefined };
  const running = renderMarkup(RowActionRestore, { ...props, isPending: true });
  const open = renderMarkup(RowActionRestore, props);

  /* A second press would send the reactivation twice, the list only redrawing once the first returns. */
  it("takes no press while it runs, and every press once it has returned", () => {
    assert.match(button(running), /\saria-disabled="true"/, "the running restore is announced as a control that can be pressed");
    assert.match(button(running), /\sdata-pending="true"/, "the running restore still takes a press");
    assert.doesNotMatch(button(open), /\saria-disabled=|\sdata-pending=/, "an idle restore is held as though its write were running");
  });

  /* `disabled` takes a button out of the tab order, which drops the keyboard's focus to the page in the
     middle of the press that started the write. */
  it("keeps the keyboard's focus where the press left it", () => {
    assert.doesNotMatch(button(running), /\sdisabled=""/, "the running restore leaves the tab order");
    assert.match(button(running), /\stabindex="0"/, "the running restore cannot be reached by the keyboard");
  });

  /* The refusal wrapper answers a reason, and a write in flight is none: swapping it in would remount the
     button under the keyboard's focus and describe a refusal nobody made. */
  it("keeps the wrapper it had before the press", () => {
    assert.ok(button(running) !== "" && button(open) !== "", "a restore rendered no control, so the comparison below proves nothing");
    assert.equal(running.replace(button(running), ""), open.replace(button(open), ""), "the running restore is wrapped differently");
  });
});

describe("a row action's name", () => {
  const ignore = () => undefined;
  const SUBJECT = "Team Lessing-Kolleg";
  const ICON = h("svg", { "aria-hidden": "true" });

  /* Every one `ACTIONS` leaves out, the menu's trigger with its fixed tooltip included: a family member a call site
     names by hand is where a verb-last name comes back. */
  const RENDERED: [action: string, html: string, named: string][] = [
    [
      "the link",
      renderMarkup(RowActionLink, { href: "/x", label: "Bearbeiten", subject: SUBJECT, children: ICON }),
      "Bearbeiten: Team Lessing-Kolleg",
    ],
    [
      "the copy",
      renderMarkup(RowActionCopy, { label: "Adresse kopieren", subject: SUBJECT, onPress: ignore }),
      "Adresse kopieren: Team Lessing-Kolleg",
    ],
    ["the menu", renderMarkup(RowActionMenu, { subject: SUBJECT, children: null }), "Weitere Aktionen: Team Lessing-Kolleg"],
  ];

  /* The tooltip's words are the only words on an icon, so speech input says them: the name starts with them
     (WCAG 2.5.3), and the row a screen reader tells the control apart by follows. */
  it("starts with the words its tooltip shows, then names the row", () => {
    for (const [action, html, named] of RENDERED) assert.deepEqual(names(html), [named], `${action} is not named by its tooltip's words first`);
  });
});
