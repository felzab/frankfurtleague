import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { act, createElement as h, memo, Profiler } from "react";

import { fireEvent, render, within } from "@testing-library/react";

import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { Navigations } from "@/shared/testing/nextContexts.ts";

const { AdminCrudSearch } = await import("./AdminCrudSearch.tsx");
const { AdminCrudShell } = await import("./AdminCrudShell.tsx");
const { AdminCrudView } = await import("./AdminCrudView.tsx");

type Row = { id: string; name: string };

const ROWS: Row[] = [
  { id: "6890a1b2c3d4e5f607190001", name: "Lena Brückner" },
  { id: "6890a1b2c3d4e5f607190002", name: "Jonas Okafor" },
];

const SEARCH_KEYS = ["name"] as const;

const LABEL = "Spieler suchen";

/** What an administrator types: a person's name, which no request line may carry. */
const NAME = "Lena";

/** The shape every admin list has: the bar in the shell's slot, the list under the boundary, joined by the shell alone. */
function mount(search = ""): { seen: Navigations; container: HTMLElement } {
  const { router, seen } = recordingRouter();

  const { container } = render(
    underNext(
      h(AdminCrudShell, {
        search: h(AdminCrudSearch, { searchLabel: LABEL, searchPlaceholder: "z.B. Erika Mustermann" }),
        children: h(AdminCrudView<Row>, {
          items: ROWS,
          searchKeys: SEARCH_KEYS,
          shape: "cards",
          renderTable: ({ filteredItems }) =>
            h(
              "ul",
              null,
              filteredItems.map((row) => h("li", { key: row.id }, row.name)),
            ),
        }),
      }),
      { router: router, pathname: "/bereich/admin/spieler", search: search },
    ),
  );

  return { seen, container };
}

const shown = (container: HTMLElement): string[] =>
  ROWS.filter((row) => within(container).queryByText(row.name) !== null).map((row) => row.name);

describe("the query every admin list holds in the page", () => {
  /* The defect this exists against: a URL is a request line nginx keeps eight days, a history entry and
     a `Referer`, and the box an administrator types a person's name into must reach none of them. */
  it("narrows the list as it is typed and writes no URL at all", async () => {
    // Every timer held to the case's own clock, so a write owed after any debounce is flushed below.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const before = window.location.href;
      const { seen, container } = mount();

      assert.deepEqual(shown(container), ["Lena Brückner", "Jonas Okafor"], "the list renders no row, so narrowing it proves nothing");

      fireEvent.change(within(container).getByRole("searchbox", { name: LABEL }), { target: { value: NAME } });
      assert.deepEqual(shown(container), ["Lena Brückner"], "the typed query never reached the list, so the two halves are joined by nothing");

      await act(async () => {
        mock.timers.runAll();
      });

      assert.deepEqual(seen.replaced, [], "the bar replaced the URL, which is the request line nginx logs");
      assert.deepEqual(seen.pushed, [], "the bar pushed a URL, which is the request line nginx logs");
      assert.equal(window.location.href, before, "the bar wrote the query into the browser's history");
    } finally {
      mock.timers.reset();
    }
  });

  /* A list thousands of rows long takes long enough to re-render that a keystroke waiting on it lags:
     the bar's own commit has to leave the memoised table alone, and the table catch up after it. */
  it("commits a keystroke before the table re-renders behind it", () => {
    let tableRenders = 0;
    const perCommit: number[] = [];
    const Table = memo(function Table({ rows }: { rows: Row[]; onDelete: unknown }) {
      tableRenders += 1;
      return h(
        "ul",
        null,
        rows.map((row) => h("li", { key: row.id }, row.name)),
      );
    });
    const { container } = render(
      underNext(
        h(Profiler, {
          id: "liste",
          onRender: () => void perCommit.push(tableRenders),
          children: h(AdminCrudShell, {
            search: h(AdminCrudSearch, { searchLabel: LABEL, searchPlaceholder: LABEL }),
            children: h(AdminCrudView<Row>, {
              items: ROWS,
              searchKeys: SEARCH_KEYS,
              shape: "cards",
              renderTable: ({ filteredItems, onDelete }) => h(Table, { rows: filteredItems, onDelete }),
            }),
          }),
        }),
      ),
    );

    perCommit.length = 0;
    const before = tableRenders;
    fireEvent.change(within(container).getByRole("searchbox", { name: LABEL }), { target: { value: NAME } });

    assert.equal(perCommit[0], before, "the keystroke's own commit re-rendered the table, so typing waits on every row");
    assert.equal(tableRenders, before + 1, "the table never caught up with the keystroke, or rendered it more than once");
    assert.deepEqual(shown(container), ["Lena Brückner"]);
  });

  /* A bar mounted outside the shell has nothing holding what is typed into it: it fails where it is
     mounted rather than taking keystrokes that go nowhere. */
  it("refuses a bar mounted with no holder", () => {
    assert.throws(() => renderTree(underNext(h(AdminCrudSearch, { searchLabel: LABEL, searchPlaceholder: LABEL }))), /AdminCrudShell/);
  });

  /* The read half of the same rule: a link or a bookmark carrying `?q=` is no way into a search. */
  it("narrows nothing by a query the URL carries", () => {
    const { container } = mount(`q=${NAME}`);

    assert.equal(within(container).getByRole<HTMLInputElement>("searchbox", { name: LABEL }).value, "", "the bar took its query from the URL");
    assert.deepEqual(shown(container), ["Lena Brückner", "Jonas Okafor"], "the list narrowed by the URL's query");
  });
});
