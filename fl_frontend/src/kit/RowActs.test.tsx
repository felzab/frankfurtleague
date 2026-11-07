// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { AccountBox, AccountRows } from "./AccountBox";
import { Button } from "./Button";
import { CardActRow } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { Table } from "./Table";

import type { ComponentProps } from "react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const VERB = COPY.shared.verb.remove;
const EMPTY = { kind: "none", plural: COPY.page.teams, glyph: "log" } as const;

/** A list whose one row's act, asked once, removes the row, or with the row the list. */
function ListOfOne({ leaves }: { leaves: "row" | "list" }) {
  const [rows, setRows] = useState(["pia@example.org"]);
  return (
    <>
      <h1>{COPY.page.teams}</h1>
      {(leaves === "row" || rows.length > 0) && (
        <Table
          label={COPY.page.teams}
          nameLabel={COPY.signIn.address}
          columns={[]}
          empty={EMPTY}
          rows={rows.map((address) => ({
            id: address,
            name: { record: address },
            cells: {},
            acts: (
              <ConfirmDialog
                verb="remove"
                subject={COPY.page.teams}
                consequence={COPY.page.teams}
                tone="danger"
                onConfirm={() => setRows([])}
                trigger={
                  <Button
                    variant="secondary"
                    label={VERB}
                  />
                }
              />
            ),
          }))}
        />
      )}
      <Button
        variant="secondary"
        label={COPY.shared.filter}
        onPress={() => setRows([])}
      />
    </>
  );
}

/** Opens the row's question and presses its act, as a keyboard's user does. */
async function removeTheRow() {
  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: VERB }));
}

// The harm: focus dropped on `body` sends a keyboard's next Tab to the top of the document, and nothing fails.
describe("a row removed by its own act", () => {
  it("hands the focus to the list it stood in, the list staying no stop for Tab", async () => {
    render(<ListOfOne leaves="row" />);
    await removeTheRow();

    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-kit-focus="home"]')));

    await userEvent.tab();
    expect(document.querySelector('[data-kit-focus="home"]')?.hasAttribute("tabindex")).toBe(false);
  });

  it("hands the focus to the page's title where the list leaves with it", async () => {
    render(<ListOfOne leaves="list" />);
    await removeTheRow();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
  });

  it("leaves alone a focus standing anywhere else", async () => {
    render(<ListOfOne leaves="row" />);
    const elsewhere = screen.getByRole("button", { name: COPY.shared.filter });

    await userEvent.click(elsewhere);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(document.activeElement).toBe(elsewhere);
  });

  it("lands a Konto row's removal on its box", async () => {
    const box = (rows: ComponentProps<typeof AccountRows>["rows"]) => (
      <AccountBox
        title={COPY.page.teams}
        description={COPY.page.teams}
        act={undefined}>
        <AccountRows rows={rows} />
      </AccountBox>
    );
    const row = {
      id: "1",
      name: { record: "Laptop" },
      detail: COPY.page.teams,
      remove: { verb: "remove", subject: COPY.page.teams, consequence: COPY.page.teams, run: async () => ({ ok: true, value: undefined }) },
    } as const;
    const { rerender } = render(box([row]));
    screen.getByRole("button", { name: VERB }).focus();

    rerender(box([]));

    await waitFor(() => expect(document.activeElement?.tagName).toBe("SECTION"));
  });

  it("lands a card row's removal on the page's title", async () => {
    const page = (held: boolean) => (
      <>
        <h1>{COPY.page.teams}</h1>
        {held && (
          <CardActRow
            href="/"
            name={{ record: "Pia" }}
            line={COPY.page.teams}
            acts={
              <Button
                variant="secondary"
                label={VERB}
              />
            }
          />
        )}
      </>
    );
    const { rerender } = render(page(true));
    screen.getByRole("button", { name: VERB }).focus();

    rerender(page(false));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
  });
});
