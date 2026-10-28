// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { chosenTab } from "./tabChoice";
import { Tabs } from "./Tabs";

const SPIELTAGE = COPY.spielplan.spieltage;
const TABS = [
  { id: "st-1", label: "1. Spieltag" },
  { id: "st-2", label: "2. Spieltag" },
];

describe("the kit's tabs", () => {
  it("makes each tab a link to the tab alone, resolved against the page's address, in a navigation named for the row", () => {
    render(
      <Tabs
        label={SPIELTAGE}
        selectedKey="st-1"
        tabs={TABS}>
        Inhalt
      </Tabs>,
    );

    const zweiter = within(screen.getByRole("navigation", { name: SPIELTAGE })).getByRole("link", { name: "2. Spieltag" });
    expect(zweiter.getAttribute("href")).toBe("?tab=st-2");
  });

  it("marks the tab the address names as the current page", () => {
    render(
      <Tabs
        label={SPIELTAGE}
        selectedKey="st-2"
        tabs={TABS}>
        Inhalt
      </Tabs>,
    );
    expect(screen.getByRole("link", { name: "2. Spieltag" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "1. Spieltag" }).hasAttribute("aria-current")).toBe(false);
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
