import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { screen } from "@testing-library/react";

import { renderUnderWrite } from "@/shared/testing/postWrite.ts";

import { FOCUS_HEADING, focusAfterWrite, focusRow, focusSection, focusSlot } from "./focusAfterWrite.ts";

import type { ReactNode } from "react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Table } = await import("@heroui/react/table");

/** A react-aria grid of rows, each holding its delete control in a cell, as an admin table draws them. */
function page(rows: readonly string[]): ReactNode {
  return h(
    "main",
    null,
    h("h1", FOCUS_HEADING, "Spieler"),
    h(
      "div",
      focusSection("tabelle"),
      h(
        Table,
        null,
        h(
          Table.ScrollContainer,
          null,
          h(
            Table.Content,
            { "aria-label": "Spieler" },
            h(Table.Header, null, h(Table.Column, { isRowHeader: true }, "Name"), h(Table.Column, null, "Aktionen")),
            h(
              Table.Body,
              null,
              rows.map((id) =>
                h(
                  Table.Row,
                  { id, key: id },
                  h(Table.Cell, null, id),
                  h(Table.Cell, null, h("div", focusRow(id), h("button", { type: "button", ...focusSlot("loeschen") }, `${id} löschen`))),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

const control = (name: string): HTMLElement => screen.getByRole("button", { name });

describe("a landing inside a react-aria grid", () => {
  /* The grid keeps its own focused row: once the refresh takes that row, the grid's effect moves the focus onto
     the next row itself, a task after the landing placed it on that row's control. */
  it("takes the focus back from the row the grid moved it to, onto the row's control", async () => {
    const view = renderUnderWrite(page(["a", "b", "c"]));
    const pressed = control("a löschen");
    // A focus the page itself gives the control, as a screen reader's does: the grid takes it onto the first row.
    act(() => pressed.focus());
    focusAfterWrite(pressed).landed();

    await view.refresh(page(["b", "c"]));
    act(() => document.body.append(document.createElement("p")));
    await view.answered();

    const expected = control("b löschen");
    assert.ok(
      document.activeElement === expected,
      `the focus is on <${document.activeElement?.tagName.toLowerCase() ?? "nothing"}> rather than „b löschen“`,
    );
  });
});
