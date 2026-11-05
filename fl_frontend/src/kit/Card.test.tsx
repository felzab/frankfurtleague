// @vitest-environment jsdom
import { renderTree } from "@/test-support/renderMarkup";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Card, CardActRow, CardLink } from "./Card";
import { CardFold } from "./CardFold";
import { Table } from "./Table";

/** The screen the browser answers: a desktop from `lg`, a phone below it. */
function onScreen(desktop: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: desktop }) as MediaQueryList);
}

const BODY = "Mika Brandt";

const folded = (
  <CardFold
    title={COPY.page.teamKader}
    count={12}>
    <p>{BODY}</p>
  </CardFold>
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
    render(folded);
    const { button } = fold();
    expect(button.textContent).toContain(COPY.page.teamKader);
    expect(document.getElementById(button.getAttribute("aria-controls") ?? "")?.textContent).toBe(BODY);
    expect(fold().open).toBe(false);
    await userEvent.click(button);
    expect(fold().open).toBe(true);
    await userEvent.click(button);
    expect(fold().open).toBe(false);
  });

  it("starts folded on every screen, as the server drew it", () => {
    // The server cannot see the screen, so a desktop opening the card at hydration would shift the page.
    expect(renderTree(folded)).toContain('aria-expanded="false"');
    for (const desktop of [false, true]) {
      onScreen(desktop);
      const card = render(folded);
      expect(fold().open).toBe(false);
      card.unmount();
    }
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

  it("lets a table in its body shrink to the card, folded or not, rather than be cut at its edge", () => {
    onScreen(true);
    const table = (
      <Table
        label={COPY.page.teamKader}
        nameLabel={COPY.page.teamKader}
        columns={[{ key: "stufe", label: COPY.shared.startelf }]}
        rows={[{ id: "1", name: { record: "Mika Brandt" }, cells: { stufe: { record: "Q2" } } }]}
        empty={{ kind: "none", plural: COPY.page.teamKader }}
      />
    );
    render(
      <>
        <Card title={COPY.page.teamKader}>{table}</Card>
        <CardFold title={COPY.page.teamKader}>{table}</CardFold>
      </>,
    );
    // jsdom draws no layout, so the shrink is read from the class of the card's own child holding the table.
    const cards = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.closest("section") ?? heading.parentElement);
    const bodies = cards.map((root) => [...(root?.children ?? [])].find((child) => child.querySelector("table") !== null));
    expect(bodies.map((body) => body?.classList.contains("min-w-0"))).toEqual([true, true]);
  });

  it("keeps its head its own height when a grid stretches the card to a neighbour's, folded or not", () => {
    render(
      <>
        <Card title={COPY.shared.saison}>
          <p>{BODY}</p>
        </Card>
        {folded}
      </>,
    );
    // jsdom draws no layout: the stretch is held by the root's packing, which gives spare height to no row.
    const roots = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.closest("section") ?? heading.parentElement);
    expect(roots.map((root) => root?.classList.contains("content-start"))).toEqual([true, true]);
  });

  // The owner's rule: every row that leads somewhere ends in the chevron, a row with acts too. A row whose chevron gave
  // way to its acts looks finished on desktop and phone alike, and nothing but an eye would see the chevron gone.
  it("ends a row in the chevron after its acts, as a row with none ends", () => {
    render(
      <>
        <CardActRow
          href="/saisons/2027"
          name={{ record: "Helmholtzschule" }}
          line={{ record: "Termin fehlt" }}
          acts={<span>acts</span>}
        />
        <CardActRow
          href="/saisons/2026"
          name={{ record: "Bettinaschule" }}
          line={{ record: "Ergebnis fehlt" }}
        />
      </>,
    );
    for (const name of ["Helmholtzschule", "Bettinaschule"]) {
      const row = screen.getByRole("link", { name }).closest(".relative.grid");
      expect(row?.lastElementChild?.querySelector("svg"), name).not.toBe(null);
    }
    expect(screen.getByText("acts").parentElement?.nextElementSibling?.querySelector("svg")).not.toBe(null);
  });

  it("makes a chooser's card one link, its title and line read as its name", () => {
    render(
      <CardLink
        href="/saisons/2027"
        title={COPY.shared.saison}
        line={{ record: "Helmholtzschule" }}
      />,
    );
    expect(screen.getByRole("link").textContent).toBe(`${COPY.shared.saison}Helmholtzschule`);
    expect(screen.getByRole("link").querySelector("svg")).not.toBe(null);
  });
});
