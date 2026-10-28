// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "react-aria-components";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { chosenTab } from "./tabChoice";
import { Tabs } from "./Tabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/saisons/2027" }));

const SPIELTAGE = COPY.spielplan.spieltage;
const TABS = [
  { id: "st-1", label: "1. Spieltag", panel: "Panel 1" },
  { id: "st-2", label: "2. Spieltag", panel: "Panel 2" },
];

describe("the kit's tabs", () => {
  it("makes each tab a link to the page's address with the tab in it", () => {
    render(
      <Tabs
        label={SPIELTAGE}
        selectedKey="st-1"
        tabs={TABS}
      />,
    );

    const zweiter = screen.getByRole("tab", { name: "2. Spieltag" });
    expect(zweiter.tagName).toBe("A");
    expect(zweiter.getAttribute("href")).toBe("/saisons/2027?tab=st-2");
  });

  it("navigates to a tab's address when it is pressed, through the app's router", async () => {
    const navigate = vi.fn();
    render(
      <RouterProvider navigate={navigate}>
        <Tabs
          label={SPIELTAGE}
          selectedKey="st-1"
          tabs={TABS}
        />
      </RouterProvider>,
    );

    await userEvent.click(screen.getByRole("tab", { name: "2. Spieltag" }));

    expect(navigate).toHaveBeenCalledWith("/saisons/2027?tab=st-2", undefined);
  });

  it("shows the tab the address names, and follows the address as it changes", () => {
    const { rerender } = render(
      <Tabs
        label={SPIELTAGE}
        selectedKey="st-2"
        tabs={TABS}
      />,
    );
    expect(screen.getByRole("tab", { name: "2. Spieltag" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel 2");

    rerender(
      <Tabs
        label={SPIELTAGE}
        selectedKey="st-1"
        tabs={TABS}
      />,
    );
    expect(screen.getByRole("tab", { name: "1. Spieltag" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel 1");
  });
});

describe("the server's choice of tab", () => {
  const IDS = ["st-1", "st-2", "st-3"];

  it("opens on the tab the address names", () => {
    expect(chosenTab({ tab: "st-3" }, IDS, "st-2")).toBe("st-3");
  });

  it("opens on the fallback where the address names no tab, or one the page does not hold", () => {
    expect(chosenTab({}, IDS, "st-2")).toBe("st-2");
    expect(chosenTab({ tab: "st-9" }, IDS, "st-2")).toBe("st-2");
    expect(chosenTab({ spieltag: "st-3" }, IDS, "st-2")).toBe("st-2");
  });

  it("reads a parameter written twice as its first value", () => {
    expect(chosenTab({ tab: ["st-1", "st-3"] }, IDS, "st-2")).toBe("st-1");
  });
});
