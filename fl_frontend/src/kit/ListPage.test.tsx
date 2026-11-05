// @vitest-environment jsdom
import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ListPage } from "./ListPage";

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
        list={{ kind: "spieltage", content: new Promise(() => undefined) }}
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
