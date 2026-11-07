// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Table } from "./Table";

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
});
