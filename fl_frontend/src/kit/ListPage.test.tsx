// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ClassicPage } from "./ClassicPage";
import { actLabel } from "./dialogAct";
import { ListPage } from "./ListPage";
import { RailPage } from "./RailFrame";

import type { AtRule, Container, Declaration, Document, Rule } from "postcss";
import type { ComponentProps } from "react";

// The strip's own links, which need no router to be read, and the address the tabs link from.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/saisons/2027", useRouter: () => ({ replace: vi.fn() }) }));

const compiled = compiledGlobals();

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

// The harm: Chrome restores a reload by a selector it saved inside `main`, which finds the wrong element in the
// placeholders, and only a reload while scrolled shows the page landing elsewhere.
describe("the frames' `main`", () => {
  it.each([
    [
      "a rail page",
      <RailPage
        key="rail"
        scope="saison"
        title={{ route: "spielplan" }}>
        {null}
      </RailPage>,
    ],
    [
      "a classic page",
      <ClassicPage
        key="classic"
        width="form">
        {null}
      </ClassicPage>,
    ],
  ])("saves no scroll anchor on %s", async (_, frame) => {
    const page = document.createElement("div");
    page.innerHTML = renderToString(frame);
    const declared = await declarationsFor([...(page.querySelector("main")?.classList ?? [])]);
    expect(declared.filter(({ decl }) => decl.prop === "overflow-anchor").map(({ decl }) => decl.value)).toStrictEqual(["none"]);
  });
});

describe("the list's create act", () => {
  // The harm: a handover's start swaps its trigger for the locked button, and the keyboard's place falls to `body`.
  it("keeps the keys in the toolbar when the act it just ran locks it", async () => {
    const name = actLabel({ verb: "create", object: COPY.page.spielplan });
    const page = (locked?: typeof COPY.template.draftUnsaved) => (
      <ListPage
        head={{ scope: "saison", title: { route: "spielplan" } }}
        create={{ title: name, act: { verb: "create", object: COPY.page.spielplan }, action: vi.fn(), children: null, locked }}
        list={{ kind: "spieltage", wait: { tabs: 7, matches: 8 }, content: new Promise(() => undefined) }}
      />
    );
    const { rerender } = render(page());
    const trigger = screen.getByRole("button", { name });
    const place = trigger.closest('[data-kit-focus="home"]');
    trigger.focus();

    rerender(page(COPY.template.draftUnsaved));

    await waitFor(() => expect(document.activeElement).toBe(place));
  });

  // The harm: a dialog's trigger around the locked button would open the create form behind the reason.
  it("answers a press with its reason while locked, never its form", async () => {
    const reason = COPY.template.draftUnsaved;
    const name = actLabel({ verb: "create", object: COPY.page.spielplan });
    render(
      <ListPage
        head={{ scope: "saison", title: { route: "spielplan" } }}
        create={{ title: name, act: { verb: "create", object: COPY.page.spielplan }, action: vi.fn(), children: null, locked: reason }}
        list={{ kind: "spieltage", wait: { tabs: 7, matches: 8 }, content: new Promise(() => undefined) }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name }));
    expect((await screen.findByRole("tooltip")).textContent).toBe(reason);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("heading", { name })).toBeNull();
  });
});

describe("the toolbar's acts the read decides", () => {
  // Read at once, since a prerender waits for every boundary, the list's among them.
  const LIST = {
    kind: "spieltage",
    wait: { tabs: 7, matches: 8 },
    content: Promise.resolve({ tabs: null, empty: { kind: "none", plural: COPY.shared.saison } as const }),
  } as const;
  const HEAD = { scope: "saison", title: { route: "spielplan" } } as const;
  const ACT = { verb: "create", object: COPY.page.spielplan } as const;
  const SIDE = { verb: "handOver", object: COPY.page.spielplan } as const;

  /** The page once every boundary holding an act has resolved, as the server streams it. */
  async function toolbar(props: Pick<ComponentProps<typeof ListPage>, "create" | "sideAct">) {
    const { prelude } = await prerender(
      <ListPage
        head={HEAD}
        {...props}
        list={LIST}
      />,
      // Every boundary in its place, where React would otherwise leave it for a script no parsed page runs.
      { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
    );
    const page = document.createElement("div");
    page.innerHTML = await new Response(prelude).text();
    return page.querySelector("[class*='only-child']");
  }

  // The harm: an administrator would see, and press, an act the server refuses them (section 6's R3: absent by role).
  it("draws neither where the read says the reader holds none", async () => {
    const bar = await toolbar({
      create: { label: actLabel(ACT), act: Promise.resolve(null) },
      sideAct: { label: actLabel(SIDE), act: Promise.resolve(null) },
    });
    expect(bar?.querySelector("button")).toBe(null);
    expect(bar?.className).toContain("has-[>:only-child:empty]:hidden");
    expect(bar?.firstElementChild?.children).toHaveLength(0);
  });
});

describe("the list template's wait", () => {
  // Under `prefers-reduced-motion: reduce` the motion tokens are unset, and a declaration reading one is
  // invalid whole: were it the `animation` shorthand, the name would fall to `none` and the skeleton, at its
  // resting opacity of 0, would never show.
  it("keeps the skeleton's animation under reduced motion, a motion token setting its duration alone", async () => {
    // The document a browser holds before the content arrives: the shell, the list's boundary at its fallback.
    const page = document.createElement("div");
    page.innerHTML = renderToString(
      <ListPage
        head={{ scope: "saison", title: { route: "spielplan" } }}
        list={{ kind: "spieltage", wait: { tabs: 7, matches: 8 }, content: new Promise(() => undefined) }}
      />,
    );
    const declared = await declarationsFor([...(page.querySelector("[aria-busy]")?.classList ?? [])]);

    const appearing = declared.filter(({ decl }) => decl.prop.startsWith("animation") || decl.prop === "opacity");
    expect(appearing.filter(({ media }) => media.length > 0)).toStrictEqual([]);
    expect(declared.filter(({ decl }) => /var\(--motion-/.test(decl.value)).map(({ decl }) => decl.prop)).toStrictEqual(["animation-duration"]);

    // The delay is declared where motion is not asked about, so it holds under reduced motion too.
    const delays: string[][] = [];
    (await compiled).walkDecls("--loading-delay", (decl) => void delays.push(mediaAbove(decl)));
    expect(delays).toStrictEqual([[]]);
  });
});
