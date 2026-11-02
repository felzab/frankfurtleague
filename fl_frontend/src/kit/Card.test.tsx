// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderTree } from "@/test-support/renderMarkup";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { buttonLook } from "./buttonStyles";
import { Card, CardLink, CardRow } from "./Card";
import { CardFold } from "./CardFold";
import { LinkRows } from "./LinkRows";
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
        <CardFold title={COPY.page.teamKader}>{table}</CardFold>
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

/** One theme's colours as the browser resolves them: the light block, and for the dark theme its own laid over it. */
function colours(theme: "light" | "dark"): Map<string, string> {
  const file = path.resolve(import.meta.dirname, "..", "app", "tokens.css");
  const blocks = { light: new Map<string, string>(), dark: new Map<string, string>() };
  postcss.parse(readFileSync(file, "utf8"), { from: file }).walkRules((rule) => {
    const block = rule.selector === ":root" ? blocks.light : rule.selector === '[data-theme="dark"]' ? blocks.dark : undefined;
    rule.walkDecls(/^--/, (declaration) => void block?.set(declaration.prop.slice(2), declaration.value.toLowerCase()));
  });
  return theme === "light" ? blocks.light : new Map([...blocks.light, ...blocks.dark]);
}

/** The colour tokens one class string fills with under the pointer. */
const hoverFills = (classes: string) =>
  classes
    .split(" ")
    .map((name) => /^(?:hover|data-hovered):bg-(.+)$/.exec(name)?.[1])
    .filter((token) => token !== undefined);

describe("a fill under the pointer on a card", () => {
  // A hover painting the card's own fill vanishes on the raised card, which nothing but an eye would notice.
  it("stands one step off the card's fill in both themes, on every row, card link and secondary button", () => {
    render(
      <>
        <Card title={COPY.shared.saison}>
          <CardRow
            href="/saisons/2027"
            name="Helmholtzschule"
          />
        </Card>
        <CardLink
          href="/saisons/2027"
          title={COPY.shared.saison}
          lineText="Bettinaschule"
        />
        <Table
          label={COPY.page.teamKader}
          nameLabel={COPY.page.teamKader}
          columns={[]}
          rows={[{ id: "1", name: "Ahorn-Gymnasium", href: "/saisons/2027", cells: {} }]}
          empty={{ kind: "none", plural: COPY.page.teamKader }}
        />
        <LinkRows rows={[{ label: COPY.template.instagram, value: "@frankfurtleague", href: "https://www.instagram.com/frankfurtleague" }]} />
      </>,
    );
    const hovered = [
      ...["Helmholtzschule", `${COPY.shared.saison}Bettinaschule`, "Ahorn-Gymnasium", COPY.template.instagram].map(
        (name) => screen.getByRole("link", { name }).closest(String.raw`[class*="hover:bg-"]`)?.className ?? "",
      ),
      buttonLook({ look: "secondary", host: "aria" }),
      buttonLook({ look: "secondary", host: "link" }),
    ];
    for (const theme of ["light", "dark"] as const) {
      const value = colours(theme);
      for (const classes of hovered) {
        const fills = hoverFills(classes);
        expect(fills, `no hover fill in ${classes}`).not.toHaveLength(0);
        for (const fill of fills) expect(value.get(fill), `${theme}: ${fill} is the card's own fill`).not.toBe(value.get("bg-card"));
      }
    }
  });
});
