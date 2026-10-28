// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Menu } from "./Menu";

describe("a navigating menu's current entry", () => {
  // The desktop menu, which opens on the page; the test window's media queries answer the phone otherwise.
  beforeEach(() => {
    const narrow = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(narrow(media), { matches: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is marked as the rail marks the current page, with no check and no dot", async () => {
    render(
      <Menu
        label={COPY.shared.saison}
        placement="below"
        trigger={
          <Button
            variant="secondary"
            label={COPY.shared.saison}
          />
        }
        groups={[
          [
            { kind: "link", href: "/saisons/2027", text: "2027", isCurrent: true },
            { kind: "link", href: "/saisons/2026", text: "2026" },
          ],
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.saison }));

    const chosen = screen.getByRole("menuitemradio", { name: "2027" });
    expect(chosen.hasAttribute("data-selected")).toBe(true);
    expect(chosen.className.split(" ")).toEqual(expect.arrayContaining(["data-selected:bg-bg-muted", "data-selected:text-brand"]));
    expect(chosen.className).not.toContain("bg-brand/12");
    expect(chosen.querySelector("svg")).toBe(null);
    // The entry holds its words alone: no dot before them.
    expect(chosen.children.length).toBe(1);
    expect(screen.getByRole("menuitemradio", { name: "2026" }).hasAttribute("data-selected")).toBe(false);
  });
});

describe("a menu's foot", () => {
  beforeEach(() => {
    const narrow = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(narrow(media), { matches: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stands after the entries and outside the menu, its words before its control", async () => {
    render(
      <Menu
        label={COPY.shared.saison}
        placement="below"
        trigger={
          <Button
            variant="secondary"
            label={COPY.shared.saison}
          />
        }
        groups={[[{ kind: "link", href: "/saisons/2027", text: "2027" }]]}
        foot={{
          label: COPY.seite.darstellung,
          control: (
            <Button
              variant="secondary"
              label={COPY.vorlage.darstellung.system}
            />
          ),
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.saison }));

    const menu = screen.getByRole("menu");
    const control = screen.getByRole("button", { name: COPY.vorlage.darstellung.system });
    const row = control.parentElement;
    expect(menu.contains(control)).toBe(false);
    // In the menu's popover, after the menu (React Aria's focus sentinels stand between them).
    expect(row?.parentElement).toBe(menu.parentElement);
    expect(menu.compareDocumentPosition(row ?? menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row?.firstElementChild?.textContent).toBe(COPY.seite.darstellung);
    expect(row?.className.split(" ")).toEqual(expect.arrayContaining(["border-t", "justify-between"]));
  });
});
