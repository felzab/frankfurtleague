// @vitest-environment jsdom
import { renderTree } from "@/test-support/renderMarkup";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Card, CardLink, CardRow } from "./Card";
import { Table } from "./Table";

import type { Folded } from "./CardFold";

/** The screen the browser answers: a desktop from `lg`, a phone below it. */
function onScreen(desktop: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: desktop }) as MediaQueryList);
}

const BODY = "Mika Brandt";

const folded = (when: Folded) => (
  <Card
    title={COPY.page.teamKader}
    count={12}
    folded={when}>
    <p>{BODY}</p>
  </Card>
);

/** The head's button, found inside the card's heading, and whether the body under it shows. */
function fold() {
  const button = within(screen.getByRole("heading", { level: 2 })).getByRole("button");
  return { button, open: button.getAttribute("aria-expanded") === "true" && screen.getByText(BODY).closest("[hidden]") === null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a folded card", () => {
  it("keeps its title a heading whose button opens and closes the body", async () => {
    onScreen(true);
    render(folded("always"));
    const { button } = fold();
    expect(button.textContent).toContain(COPY.page.teamKader);
    expect(document.getElementById(button.getAttribute("aria-controls") ?? "")?.textContent).toBe(BODY);
    expect(fold().open).toBe(false);
    await userEvent.click(button);
    expect(fold().open).toBe(true);
    await userEvent.click(button);
    expect(fold().open).toBe(false);
  });

  it("folded on a phone alone, starts folded on a phone and open on a desktop", () => {
    onScreen(false);
    const phone = render(folded("phone"));
    expect(fold().open).toBe(false);
    phone.unmount();
    onScreen(true);
    render(folded("phone"));
    expect(fold().open).toBe(true);
  });

  it("folded on a phone alone, reaches the browser folded, so a phone never folds what it showed", () => {
    // The server cannot see the screen; a desktop opens the card at hydration instead.
    const markup = renderTree(folded("phone"));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/<div[^>]*hidden=""[^>]*><p>Mika Brandt<\/p>/);
  });
});

describe("a card", () => {
  it("makes its title a heading, with its count beside it", () => {
    render(
      <Card
        title={COPY.shared.saison}
        count={3}
      />,
    );
    expect(screen.getByRole("heading", { name: COPY.shared.saison })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("holds its records as rows, each one link through its name with its chip after the name", () => {
    render(
      <Card title={COPY.shared.saison}>
        <CardRow
          href="/saisons/2027"
          name="Helmholtzschule"
          chip={{ tone: "warn", label: COPY.shared.startelf }}
        />
      </Card>,
    );
    const link = screen.getByRole("link", { name: "Helmholtzschule" });
    expect(link.getAttribute("href")).toBe("/saisons/2027");
    // The name and its chip share one line, the chip after the name.
    const line = link.parentElement?.parentElement;
    expect(line?.lastElementChild?.textContent).toBe(COPY.shared.startelf);
    // The row ends in the chevron that says it leads on.
    expect(line?.parentElement?.lastElementChild?.querySelector("svg")).not.toBe(null);
  });

  it("keeps a long name on the chip's line, cut with its full text as its title", () => {
    const name = "Carlo-Mierendorff-Schule Frankfurt-Preungesheim";
    render(
      <Card title={COPY.shared.saison}>
        <CardRow
          href="/saisons/2027"
          name={name}
          chip={{ tone: "warn", label: COPY.shared.startelf }}
        />
      </Card>,
    );
    // jsdom draws no layout, so the cut is read from its classes: the name truncates, its line never wraps.
    const cut = screen.getByRole("link", { name }).parentElement;
    expect(cut?.classList.contains("truncate")).toBe(true);
    expect(cut?.getAttribute("title")).toBe(name);
    expect(cut?.parentElement?.classList.contains("flex-wrap")).toBe(false);
  });

  it("lets a table in its body shrink to the card, folded or not, rather than be cut at its edge", () => {
    onScreen(true);
    const table = (
      <Table
        label={COPY.page.teamKader}
        nameLabel={COPY.page.teamKader}
        columns={[{ key: "stufe", label: COPY.shared.startelf }]}
        rows={[{ id: "1", name: "Mika Brandt", cells: { stufe: "Q2" } }]}
        empty={{ kind: "none", plural: COPY.page.teamKader }}
      />
    );
    render(
      <>
        <Card title={COPY.page.teamKader}>{table}</Card>
        <Card
          title={COPY.page.teamKader}
          folded="phone">
          {table}
        </Card>
      </>,
    );
    // jsdom draws no layout, so the shrink is read from the class of the card's own child holding the table.
    const cards = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.closest("section") ?? heading.parentElement);
    const bodies = cards.map((root) => [...(root?.children ?? [])].find((child) => child.querySelector("table") !== null));
    expect(bodies.map((body) => body?.classList.contains("min-w-0"))).toEqual([true, true]);
  });

  it("makes a chooser's card one link, its title and line read as its name", () => {
    render(
      <CardLink
        href="/saisons/2027"
        title={COPY.shared.saison}
        lineText="Helmholtzschule"
      />,
    );
    expect(screen.getByRole("link").textContent).toBe(`${COPY.shared.saison}Helmholtzschule`);
    expect(screen.getByRole("link").querySelector("svg")).not.toBe(null);
  });
});
