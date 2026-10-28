// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ListPage } from "./ListPage";

import type { ComponentProps } from "react";

// The strip's own links, which need no router to be read, and the address the tabs link from.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/saisons/2027" }));

const SPIELTAGE = COPY.spielplan.spieltage;

describe("the list template's matchday list", () => {
  it("shows its empty state in the tabs' place while the season has no matchday", () => {
    render(
      <ListPage
        head={{ area: "saison", title: { route: "spielplan" } }}
        list={{ kind: "spieltage", tabs: null, empty: { kind: "noch", plural: SPIELTAGE } }}
      />,
    );

    expect(screen.getByText(COPY.shared.leer.noch(SPIELTAGE))).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(COPY.seite.spielplan);
  });

  it("shows the tabs, and no empty state, once a matchday stands", () => {
    render(
      <ListPage
        head={{ area: "saison", title: { route: "spielplan" } }}
        list={{
          kind: "spieltage",
          tabs: { label: SPIELTAGE, selectedKey: "1", tabs: [{ id: "1", label: "1. Spieltag", panel: null }] },
          empty: { kind: "noch", plural: SPIELTAGE },
        }}
      />,
    );

    expect(screen.getByRole("tablist", { name: SPIELTAGE })).toBeTruthy();
    expect(screen.queryByText(COPY.shared.leer.noch(SPIELTAGE))).toBeNull();
  });
});
