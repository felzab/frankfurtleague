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
import { Dialog } from "./Dialog";
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
                trigger={{ label: VERB }}
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

  // The harm: a row a page read again takes away while the person reads with a pointer pulling the focus onto the row
  // beside it, where a screen reader announces a record nobody chose.
  it("leaves alone a focus standing nowhere", async () => {
    const list = (addresses: readonly string[]) => (
      <Table
        label={COPY.page.teams}
        nameLabel={COPY.signIn.address}
        columns={[]}
        empty={EMPTY}
        rows={addresses.map((address) => ({
          id: address,
          name: { record: address },
          cells: {},
          acts: (
            <Button
              variant="secondary"
              label={VERB}
            />
          ),
        }))}
      />
    );
    const { rerender } = render(list(["pia@example.org", "ben@example.org"]));

    rerender(list(["ben@example.org"]));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(document.activeElement).toBe(document.body);
  });

  // The harm: a page torn down whole with the focus in a row, its handover arriving once another page stands and taking
  // that page's focus to its title, ahead of whatever that page's own act hands it to.
  it("hands nothing to a page standing after its own left whole", async () => {
    const left = render(<Listing leaves="row" />);
    screen.getByRole("button", { name: VERB }).focus();
    left.unmount();
    left.container.remove();
    render(<h1>{COPY.page.teams}</h1>);

    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);

    expect(document.activeElement).toBe(document.body);
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

describe("a row's acts", () => {
  // The harm: the answer keeps the row and only its acts leave, as a booking turns „Zugesagt“; the focus moving to the
  // next record's link leaves the reader on another record, the row's new state unheard.
  it("hand the focus to their own row's link where the answer keeps the row", async () => {
    const page = (open: boolean) => (
      <>
        {["Pia", "Ben"].map((name) => (
          <CardActRow
            key={name}
            href="/"
            name={{ record: name }}
            {...(open || name !== "Pia"
              ? {
                  acts: (
                    <Button
                      variant="secondary"
                      label={VERB}
                    />
                  ),
                }
              : {})}
          />
        ))}
      </>
    );
    const { rerender } = render(page(true));
    screen.getAllByRole("button", { name: VERB })[0]?.focus();

    rerender(page(false));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Pia" })));
  });
});

const SQUAD = ["pia@example.org", "ben@example.org", "tom@example.org"];

/**
 * A list whose rows each open one question held beside the list, whose act leaves the row standing but opening nothing,
 * as a squad row taken out does: asked straight, or, as the squad's own page asks it, from the danger row of the row's
 * dialog. The page read again arrives while the question still stands, as an action's does. `out` names the rows taken
 * out before the page opens.
 */
function Squad({ asked, out = [] }: { asked: "straight" | "fromDialog"; out?: readonly string[] }) {
  const [live, setLive] = useState(() => SQUAD.filter((address) => !out.includes(address)));
  const [opened, setOpened] = useState<string | null>(null);
  const open = { isOpen: opened !== null, onOpenChange: (isOpen: boolean) => setOpened(isOpen ? opened : null) };
  const question = {
    verb: "remove",
    subject: COPY.page.teams,
    consequence: COPY.page.teams,
    tone: "danger",
    onConfirm: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setLive((addresses) => addresses.filter((address) => address !== opened));
      // A frame with the row's press gone and the question still standing over the page.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    },
  } as const;
  return (
    <>
      <h1>{COPY.page.teams}</h1>
      <Table
        label={COPY.page.teams}
        nameLabel={COPY.signIn.address}
        columns={[]}
        empty={EMPTY}
        rows={SQUAD.map((address) => ({
          id: address,
          name: { record: address },
          cells: {},
          muted: !live.includes(address),
          ...(live.includes(address) ? { onOpen: () => setOpened(address) } : {}),
        }))}
      />
      {asked === "straight" ? (
        <ConfirmDialog
          {...question}
          open={open}
        />
      ) : (
        <Dialog
          title={COPY.page.teams}
          act={{ verb: "save" }}
          action={async () => ({ ok: true, value: undefined })}
          open={open}
          danger={{ name: COPY.page.teams, consequence: COPY.page.teams, confirm: question }}>
          {null}
        </Dialog>
      )}
    </>
  );
}

// The harm: the question hands the focus back to the row's press it opened from, or to the row's dialog leaving with
// the act, each gone by then, so the focus drops on `body` and a keyboard's next Tab starts at the top of the document.
describe("a row its own question's act leaves opening nothing", () => {
  /** Opens the first row's question and presses its act, as a keyboard's user does; the row after it takes the focus. */
  it.each([["straight"], ["fromDialog"]] as const)("hands the focus to the row after it once the question closes, asked %s", async (asked) => {
    render(<Squad asked={asked} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    if (asked === "fromDialog") await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: VERB }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: VERB }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    const after = screen.getByRole("row", { name: /ben@example.org/ });
    await waitFor(() => expect(document.activeElement).toBe(within(after).getByRole("button")));
  });

  // The harm: the row beside it taken out earlier, the focus falls to the whole table and a keyboard's next Tab starts
  // the list over, though a row further on still opens.
  it.each([
    ["after it", 1, "tom@example.org"],
    ["before it, where none after opens", 2, "pia@example.org"],
  ])("passes over a row opening nothing to the nearest row that opens, %s", async (_case, place, landsOn) => {
    render(
      <Squad
        asked="straight"
        out={["ben@example.org"]}
      />,
    );
    for (let press = 0; press < place; press += 1) await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: VERB }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    const landed = screen.getByRole("row", { name: (name) => name.includes(landsOn) });
    await waitFor(() => expect(document.activeElement).toBe(within(landed).getByRole("button")));
  });
});
