// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { SeatRows } from "./SeatRows";
import { SideActs } from "./SideActs";
import { Table } from "./Table";

import type { SideAct } from "./SideActs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const SEND = COPY.shared.withObject(COPY.account.address.link, "send");
const DISCARD = COPY.shared.verb.discard;
const MORE = COPY.template.more;

beforeEach(() => {
  // A rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
});

describe("a row's side acts folded", () => {
  // The harm: a locked act's entry is one the keys pass over, as a disabled entry is, so nobody on a keyboard reaches
  // the reason under its label; or its press runs the act after all.
  it("keep a locked act's entry in the keys' reach, its press running nothing", async () => {
    const edit = vi.fn();
    render(
      <SideActs
        acts={[
          { label: SEND, onPress: () => undefined },
          { label: DISCARD, locked: COPY.shared.failure.stale, onPress: edit },
        ]}
      />,
    );

    screen.getByRole("button", { name: MORE }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    const locked = within(screen.getByRole("menu")).getByRole("menuitem", { name: DISCARD });
    expect(document.activeElement).toBe(locked);

    await userEvent.keyboard("{Enter}");
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeDefined();
  });
});

/** Each row's side acts, the row saying how many it carries, as every page builds its rows. */
const LISTS = {
  table: (rows: ReadonlyArray<ReadonlyArray<SideAct>>) => (
    <Table
      label={COPY.account.address.change}
      nameLabel={COPY.admin.facts.before}
      columns={[]}
      rows={rows.map((acts, index) => ({
        id: String(index),
        name: { record: `person${String(index)}@example.org` },
        cells: {},
        sideActs: acts.length,
        acts: <SideActs acts={acts} />,
      }))}
      empty={{ kind: "none", plural: COPY.account.address.change }}
    />
  ),
  seats: (rows: ReadonlyArray<ReadonlyArray<SideAct>>) => (
    <SeatRows
      label={COPY.team.kontakte}
      rows={rows.map((acts, index) => ({
        id: String(index),
        name: { record: `Person ${String(index)}` },
        chips: [],
        line: { record: `person${String(index)}@example.org` },
        sideActs: acts.length,
        acts: <SideActs acts={acts} />,
      }))}
    />
  ),
};

describe.each(Object.entries(LISTS))("the side acts of a list's rows (%s)", (_, listOf) => {
  // The harm: a row of two acts draws only one of its forms, the labelled buttons a wide box shows or the „⋯“ a narrow
  // one shows; or a button's press runs nothing. Which form each width shows is the browser's to judge.
  it("are labelled buttons and one „⋯“ alike, a button's press running its act", async () => {
    const discard = vi.fn();
    render(
      listOf([
        [
          { label: SEND, onPress: () => undefined },
          { label: DISCARD, tone: "danger", onPress: discard },
        ],
        [{ label: DISCARD, tone: "danger", onPress: () => undefined }],
      ]),
    );

    const labelled = [...screen.getAllByRole("button", { name: SEND }), ...screen.getAllByRole("button", { name: DISCARD })];
    expect(labelled).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: MORE })).toHaveLength(2);

    await userEvent.click(screen.getAllByRole("button", { name: DISCARD })[0] as HTMLElement);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  // The harm: a row leaves out an act its neighbours show, or shows it as if it could run, and nobody learns why it
  // cannot.
  it("list a locked act in both forms with its reason, its press running nothing", async () => {
    const discard = vi.fn();
    const reason = COPY.shared.failure.stale;
    render(
      listOf([
        [
          { label: SEND, onPress: () => undefined },
          { label: DISCARD, tone: "danger", locked: reason, onPress: discard },
        ],
      ]),
    );

    const button = screen.getByRole("button", { name: DISCARD });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(
      button
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent),
    ).toContain(reason);
    await userEvent.click(button);

    await userEvent.click(screen.getByRole("button", { name: MORE }));
    const entry = within(screen.getByRole("menu")).getByRole("menuitem", { name: DISCARD });
    expect(entry.textContent).toBe(`${DISCARD}${reason}`);
    await userEvent.click(entry);
    expect(discard).not.toHaveBeenCalled();
  });
});
