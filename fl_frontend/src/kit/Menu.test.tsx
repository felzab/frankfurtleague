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

  // A chosen entry is told from the rest by its check as well as its green words; with the check gone, the colour
  // alone marks it, which a reader who cannot tell green apart cannot see, and nothing else would say so.
  it("is marked as every list marks its chosen entry, its check at the end", async () => {
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
            { kind: "link", href: "/saisons/2027", label: { record: "2027" }, isCurrent: true },
            { kind: "link", href: "/saisons/2026", label: { record: "2026" } },
          ],
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.saison }));

    const chosen = screen.getByRole("menuitemradio", { name: "2027" });
    expect(chosen.hasAttribute("data-selected")).toBe(true);
    expect(chosen.lastElementChild?.querySelector("svg")).not.toBe(null);
    const other = screen.getByRole("menuitemradio", { name: "2026" });
    expect(other.hasAttribute("data-selected")).toBe(false);
    expect(other.querySelector("svg")).toBe(null);
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
        groups={[[{ kind: "link", href: "/saisons/2027", label: { record: "2027" } }]]}
        foot={{
          label: COPY.page.accountAppearance,
          control: (
            <Button
              variant="secondary"
              label={COPY.template.theme.system}
            />
          ),
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.saison }));

    const menu = screen.getByRole("menu");
    const control = screen.getByRole("button", { name: COPY.template.theme.system });
    const row = control.parentElement;
    expect(menu.contains(control)).toBe(false);
    // In the menu's popover, after the menu (React Aria's focus sentinels stand between them).
    expect(row?.parentElement).toBe(menu.parentElement);
    expect(menu.compareDocumentPosition(row ?? menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row?.firstElementChild?.textContent).toBe(COPY.page.accountAppearance);
  });
});
