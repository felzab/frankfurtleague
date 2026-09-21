import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
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
function mount(privateQuery: boolean): Navigations {
  const { router, seen } = recordingRouter();

  render(
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

  return seen;
}

const rowsOnScreen = (): number => ROWS.filter((row) => screen.queryByText(row.grund) !== null).length;

describe("the query a page holds rather than writing", () => {
  /* The defect this exists against: a segment that awaits the request logs every `?q=` as a request
     line, and the one box this page offers is the box an address gets typed into. */
  it("narrows the list and makes no navigation at all", async () => {
    const user = userEvent.setup();
    const seen = mount(true);

    assert.equal(rowsOnScreen(), ROWS.length, "the list renders no row, so narrowing it below proves nothing");

    await user.type(screen.getByRole("searchbox", { name: LABEL }), ADDRESS);
    // The ordinary bar's debounce, waited out before anything is judged: a write arriving late is still a write.
    await new Promise((settle) => setTimeout(settle, 600));

    assert.deepEqual(seen.replaced, [], "the page replaced the URL, which is the request line nginx logs");
    assert.deepEqual(seen.pushed, [], "the page pushed a URL, which is the request line nginx logs");
    assert.equal(rowsOnScreen(), 0, "the typed query never reached the list, so the two halves are joined by nothing");
  });

  /* The control the case above needs, and the neighbours' own behaviour: eight routes narrow through
     `?q=`, where back and forward are what the reader expects to work. */
  it("still reaches the URL on a page that asks for none", async () => {
    const user = userEvent.setup();
    const seen = mount(false);

    await user.type(screen.getByRole("searchbox", { name: LABEL }), "Fremde");

    await waitFor(() => {
      assert.equal(seen.replaced.length, 1, "the ordinary bar wrote no query to the URL");
    });
    assert.match(seen.replaced[0] ?? "", /^\/admin\/sperrliste\?q=Fremde$/, "the ordinary bar wrote something other than the typed query");
    assert.equal(rowsOnScreen(), ROWS.length, "the list narrowed off the field rather than off the URL the router never changed");
  });
});
