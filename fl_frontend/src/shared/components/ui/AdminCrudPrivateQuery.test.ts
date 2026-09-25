import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { Navigations } from "@/shared/testing/nextContexts.ts";

const { AdminCrudSearch } = await import("./AdminCrudSearch.tsx");
const { AdminCrudShell } = await import("./AdminCrudShell.tsx");
const { AdminCrudView } = await import("./AdminCrudView.tsx");

type Row = { id: string; grund: string };

const ROWS: Row[] = [
  { id: "6890a1b2c3d4e5f607190001", grund: "Falsches Geburtsdatum angegeben" },
  { id: "6890a1b2c3d4e5f607190002", grund: "Fremde Namen eingetragen" },
];

const SEARCH_KEYS = ["grund"] as const;

const LABEL = "Sperren suchen";

/* What an administrator asking „ist die gesperrt?“ types, which matches no row: the address is a
   keyed hash, so the list it narrows to is empty however the query travels. */
const ADDRESS = "zorbanax@beispielschule.de";

/** The shape every admin list has: the bar in the shell's slot, the list under the boundary, joined by the shell alone. */
function mount(privateQuery: boolean): { seen: Navigations; container: HTMLElement } {
  const { router, seen } = recordingRouter();

  const { container } = render(
    underNext(
      h(AdminCrudShell, {
        privateQuery: privateQuery,
        search: h(AdminCrudSearch, { searchLabel: LABEL, searchPlaceholder: "z.B. falsches Geburtsdatum" }),
        children: h(AdminCrudView<Row>, {
          items: ROWS,
          searchKeys: SEARCH_KEYS,
          shape: "cards",
          renderTable: ({ filteredItems }) =>
            h(
              "ul",
              null,
              filteredItems.map((row) => h("li", { key: row.id }, row.grund)),
            ),
        }),
      }),
      { router: router, pathname: "/admin/sperrliste" },
    ),
  );

  return { seen, container };
}

const rowsIn = (container: HTMLElement): number => ROWS.filter((row) => within(container).queryByText(row.grund) !== null).length;

describe("the query a page holds rather than writing", () => {
  /* The defect this exists against: a segment that awaits the request logs every `?q=` as a request
     line, and the one box this page offers is the box an address gets typed into. */
  it("narrows the list and makes no navigation at all", async () => {
    const user = userEvent.setup();
    const { seen, container } = mount(true);

    assert.equal(rowsIn(container), ROWS.length, "the list renders no row, so narrowing it below proves nothing");

    await user.type(within(container).getByRole("searchbox", { name: LABEL }), ADDRESS);
    // Timed by an ordinary bar typed after it rather than by a clock: once that one has written, a write this
    // one owed has landed too, however long the debounce runs.
    const ordinary = mount(false);
    await user.type(within(ordinary.container).getByRole("searchbox", { name: LABEL }), "Fremde");
    await waitFor(() => {
      assert.equal(ordinary.seen.replaced.length, 1, "the ordinary bar wrote no query to the URL, so nothing times this case");
    });

    assert.deepEqual(seen.replaced, [], "the page replaced the URL, which is the request line nginx logs");
    assert.deepEqual(seen.pushed, [], "the page pushed a URL, which is the request line nginx logs");
    assert.equal(rowsIn(container), 0, "the typed query never reached the list, so the two halves are joined by nothing");
  });

  /* The control the case above needs, and the neighbours' own behaviour: eight routes narrow through
     `?q=`, where back and forward are what the reader expects to work. */
  it("still reaches the URL on a page that asks for none", async () => {
    const user = userEvent.setup();
    const { seen, container } = mount(false);

    await user.type(within(container).getByRole("searchbox", { name: LABEL }), "Fremde");

    await waitFor(() => {
      assert.equal(seen.replaced.length, 1, "the ordinary bar wrote no query to the URL");
    });
    assert.match(seen.replaced[0] ?? "", /^\/admin\/sperrliste\?q=Fremde$/, "the ordinary bar wrote something other than the typed query");
    assert.equal(rowsIn(container), ROWS.length, "the list narrowed off the field rather than off the URL the router never changed");
  });
});
