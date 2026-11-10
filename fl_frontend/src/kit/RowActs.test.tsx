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

/** A list whose row's act, asked once, removes the row, or with its last row the list. */
function Listing({ leaves, addresses = ["pia@example.org"] }: { leaves: "row" | "list"; addresses?: readonly string[] }) {
  const [rows, setRows] = useState(addresses);
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
                onConfirm={() => setRows(rows.filter((other) => other !== address))}
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

/**
 * Opens the question of the list's `place`th row and presses its act, as a keyboard's user does, until the act is done.
 * The question runs its act in a transition, which commits on a later task than the press: until then the question
 * stands busy and the page under it is hidden from every query.
 */
async function removeTheRow(place = 1) {
  await userEvent.tab();
  for (let row = 1; row < place; row += 1) await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: VERB }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

// The harm: focus dropped on `body` sends a keyboard's next Tab to the top of the document, and nothing fails.
describe("a row removed by its own act", () => {
  // The harm beyond `body`: the list's top row taking it would send a keyboard back past every row it had worked through.
  it.each([
    ["the row after it", 1],
    ["the row before it, where none follows", 3],
  ])("hands the focus to %s", async (_case, place) => {
    render(
      <Listing
        leaves="row"
        addresses={["pia@example.org", "ben@example.org", "tom@example.org"]}
      />,
    );
    await removeTheRow(place);

    const landed = screen.getByRole("row", { name: /ben@example.org/ });
    await waitFor(() => expect(document.activeElement).toBe(within(landed).getByRole("button", { name: VERB })));
  });

  it("hands the focus to the list it stood in, the list staying no stop for Tab", async () => {
    render(<Listing leaves="row" />);
    await removeTheRow();

    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-kit-focus="home"]')));

    await userEvent.tab();
    expect(document.querySelector('[data-kit-focus="home"]')?.hasAttribute("tabindex")).toBe(false);
  });

  it("hands the focus to the page's title where the list leaves with it", async () => {
    render(<Listing leaves="list" />);
    await removeTheRow();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
  });

  it("leaves alone a focus standing anywhere else", async () => {
    render(<Listing leaves="row" />);
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
