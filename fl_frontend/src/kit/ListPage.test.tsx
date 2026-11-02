// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { within } from "@testing-library/react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ListPage } from "./ListPage";

import type { AtRule, Container, Declaration, Document, Rule } from "postcss";
import type { ComponentProps, ReactElement } from "react";
import type { Filter } from "./Filters";
import type { SpieltageContent } from "./ListPage";

// The strip's own links, which need no router to be read, and the address the tabs link from.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/saisons/2027", useRouter: () => ({ replace: vi.fn() }) }));

const SPIELTAGE = COPY.spielplan.spieltage;
const compiled = compiledGlobals();

/** The document a browser holds before the content arrives: the shell, every boundary at its fallback. */
function shell(page: ReactElement): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = renderToString(page);
  return root;
}

/** The document once every boundary has its content. */
async function streamed(page: ReactElement): Promise<HTMLElement> {
  const stream = await renderToReadableStream(page);
  await stream.allReady;
  const root = document.createElement("div");
  root.innerHTML = await new Response(stream).text();
  return root;
}

const spielplan = (content: Promise<SpieltageContent>) => (
  <ListPage
    head={{ scope: "saison", title: { route: "spielplan" } }}
    list={{ kind: "spieltage", content }}
  />
);

/** The media queries a declaration stands under, innermost first. */
function mediaAbove(decl: Declaration): string[] {
  const queries: string[] = [];
  for (let node: Container | Document | undefined = decl.parent; node != null; node = node.parent) {
    if (node.type === "atrule" && (node as AtRule).name === "media") queries.push((node as AtRule).params);
  }
  return queries;
}

/** Each declaration the stylesheet makes for one of `classes`, with the media queries it stands under. */
async function declarationsFor(classes: readonly string[]): Promise<{ decl: Declaration; media: string[] }[]> {
  const found: { decl: Declaration; media: string[] }[] = [];
  (await compiled).walkDecls((decl) => {
    if (decl.parent?.type !== "rule") return;
    const selectors = selectorsOf(decl.parent as Rule).map((selector) => selector.replace(/\\(.)/g, "$1"));
    if (!selectors.some((selector) => classes.some((name) => selector.includes(`.${name}`)))) return;
    found.push({ decl, media: mediaAbove(decl) });
  });
  return found;
}

describe("the list template's wait", () => {
  it("draws the title and the skeleton at once, the skeleton invisible until its delay passes", async () => {
    const page = shell(spielplan(new Promise(() => undefined)));

    expect(within(page).getByRole("heading", { level: 1 }).textContent).toBe(COPY.page.spielplan);
    // The status says it in its subtree, which a live region announces, where a name alone is not.
    expect(within(page).getByRole("status").textContent).toBe(COPY.shared.loading);

    const skeleton = page.querySelector<HTMLElement>("[aria-busy]");
    const declared = await declarationsFor([...(skeleton?.classList ?? [])]);
    const value = (prop: string) => declared.filter(({ decl }) => decl.prop === prop).map(({ decl }) => decl.value);
    expect(value("opacity").map((opacity) => Number.parseFloat(opacity))).toStrictEqual([0]);
    expect(value("animation-name")).toStrictEqual(["kit-appear"]);
    expect(value("animation-delay")).toStrictEqual(["var(--loading-delay)"]);
    expect(value("animation-fill-mode")).toStrictEqual(["forwards"]);
  });

  // Under `prefers-reduced-motion: reduce` the motion tokens are unset, and a declaration reading one is
  // invalid whole: were it the `animation` shorthand, the name would fall to `none` and the skeleton, at its
  // resting opacity of 0, would never show.
  it("keeps the skeleton's animation under reduced motion, a motion token setting its duration alone", async () => {
    const page = shell(spielplan(new Promise(() => undefined)));
    const declared = await declarationsFor([...(page.querySelector("[aria-busy]")?.classList ?? [])]);

    const appearing = declared.filter(({ decl }) => decl.prop.startsWith("animation") || decl.prop === "opacity");
    expect(appearing.filter(({ media }) => media.length > 0)).toStrictEqual([]);
    expect(declared.filter(({ decl }) => /var\(--motion-/.test(decl.value)).map(({ decl }) => decl.prop)).toStrictEqual(["animation-duration"]);

    // The delay is declared where motion is not asked about, so it holds under reduced motion too.
    const delays: string[][] = [];
    (await compiled).walkDecls("--loading-delay", (decl) => void delays.push(mediaAbove(decl)));
    expect(delays).toStrictEqual([[]]);
  });

  it("draws the content in the skeleton's place once it is read", async () => {
    const page = await streamed(
      spielplan(
        Promise.resolve({
          tabs: { label: SPIELTAGE, selectedKey: "1", tabs: [{ id: "1", label: "1. Spieltag", panel: "Spiele des ersten" }] },
          empty: { kind: "none", plural: SPIELTAGE },
        }),
      ),
    );

    expect(within(page).getByRole("link", { name: "1. Spieltag" }).getAttribute("aria-current")).toBe("page");
    expect(within(page).queryByRole("status")).toBeNull();
  });
});

describe("the list template's filter block", () => {
  const filtered = (filters: Promise<ReadonlyArray<Filter>>) => (
    <ListPage
      head={{ scope: "saison", title: { route: "spielSearch" } }}
      filters={filters}
      list={{ kind: "tree", content: Promise.resolve({ tree: null, empty: { kind: "none", plural: SPIELTAGE } }) }}
    />
  );
  const SPIELTAG: Filter = { name: "spieltag", label: COPY.page.spielplan, all: COPY.page.spielplan, options: [], value: null };

  /** The heights a class list declares below `lg`, each with the media queries it stands under. */
  async function phoneHeights(element: Element | null | undefined): Promise<string[]> {
    const declared = await declarationsFor([...(element?.classList ?? [])]);
    return declared
      .filter(({ decl, media }) => decl.prop === "height" && !media.some((query) => query.includes("64rem")))
      .map(({ decl, media }) => [...media, decl.value].join(" "))
      .sort();
  }

  it("holds its place at the „Filter“ button's height on a phone while its choices are read", async () => {
    const waiting = shell(filtered(new Promise(() => undefined)));
    const read = await streamed(filtered(Promise.resolve([SPIELTAG])));

    // The toolbar is the column's first row, and holds the filter block alone here, so its last element is the
    // block's place.
    const space = waiting.querySelector("main")?.firstElementChild?.firstElementChild?.lastElementChild;
    expect(space?.getAttribute("aria-hidden")).toBe("true");
    // By its text: the page stands outside the document, where a name another element gives cannot be resolved.
    const button = within(read)
      .getAllByRole("button")
      .find((element) => element.textContent === COPY.shared.filter);
    expect(button).toBeDefined();
    const held = await phoneHeights(space);
    expect(held).not.toStrictEqual([]);
    expect(held).toStrictEqual(await phoneHeights(button));
  });
});

describe("the list template's matchday list", () => {
  it("shows its empty state in the tabs' place while the season has no matchday", async () => {
    const page = await streamed(spielplan(Promise.resolve({ tabs: null, empty: { kind: "none", plural: SPIELTAGE } })));

    expect(within(page).getByText(COPY.shared.empty.none(SPIELTAGE))).toBeTruthy();
    expect(within(page).queryByRole("navigation", { name: SPIELTAGE })).toBeNull();
    expect(within(page).getByRole("heading", { level: 1 }).textContent).toBe(COPY.page.spielplan);
  });

  it("shows the tabs and the chosen matchday's matches alone, and no empty state, once a matchday stands", async () => {
    const page = await streamed(
      spielplan(
        Promise.resolve({
          tabs: {
            label: SPIELTAGE,
            selectedKey: "2",
            tabs: [
              { id: "1", label: "1. Spieltag", panel: "Spiele des ersten" },
              { id: "2", label: "2. Spieltag", panel: "Spiele des zweiten" },
            ],
          },
          empty: { kind: "none", plural: SPIELTAGE },
        }),
      ),
    );

    const tabs = within(page).getByRole("navigation", { name: SPIELTAGE });
    expect(within(tabs).getByRole("link", { name: "2. Spieltag" }).getAttribute("aria-current")).toBe("page");
    expect(within(page).getByText("Spiele des zweiten")).toBeTruthy();
    expect(within(page).queryByText("Spiele des ersten")).toBeNull();
    expect(within(page).queryByText(COPY.shared.empty.none(SPIELTAGE))).toBeNull();
  });
});
