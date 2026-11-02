// @vitest-environment jsdom
import { within } from "@testing-library/react";
import { renderToReadableStream, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import { LandingPage } from "./LandingPage";
import { LandingSection } from "./LandingSection";
import { SaisonBlock } from "./SaisonBlock";

import type { ComponentProps, ReactElement } from "react";
import type { LandingContent } from "./LandingPage";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const { landing } = SERVER_COPY;

const CONTENT: LandingContent = {
  secondary: { label: COPY.page.about, href: ROUTES.about.path() },
  aside: (
    <SaisonBlock
      title={COPY.shared.saisonName("2027")}
      state={{ kind: "undated" }}
    />
  ),
  sections: (
    <LandingSection title={landing.season.title}>
      <></>
    </LandingSection>
  ),
};

/** The landing with its hero's fixed parts and the given read. */
function landingWith(content: Promise<LandingContent>): ReactElement {
  return (
    <LandingPage
      title={landing.tagline}
      lead={landing.paragraph}
      primary={{ label: COPY.page.spielplan, href: ROUTES.saisons.path() }}
      content={content}
    />
  );
}

/** The document once every boundary has its content. */
async function streamed(page: ReactElement): Promise<HTMLElement> {
  const stream = await renderToReadableStream(page);
  await stream.allReady;
  const root = document.createElement("div");
  root.innerHTML = await new Response(stream).text();
  return root;
}

describe("the landing while its read is on its way", () => {
  it("stands its tagline and the Spielplan's way at once, and the season card's skeleton", () => {
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(landingWith(new Promise(() => undefined)));
    expect(within(waiting).getByRole("heading", { level: 1 }).textContent).toBe(landing.tagline);
    expect(
      within(waiting)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toStrictEqual([COPY.page.spielplan]);
    expect(within(waiting).getByRole("status").textContent).toBe(COPY.shared.loading);
    expect(within(waiting).queryByRole("heading", { level: 2 })).toBeNull();
  });
});

describe("the landing once read", () => {
  it("adds the second way on, the season's card and the sections, and no skeleton", async () => {
    const page = await streamed(landingWith(Promise.resolve(CONTENT)));
    expect(
      within(page)
        .getAllByRole("link", { name: /./ })
        .map((link) => link.textContent),
    ).toStrictEqual([COPY.page.spielplan, COPY.page.about]);
    expect(within(page).getByText(landing.saison.undated)).toBeTruthy();
    expect(within(page).getByRole("heading", { level: 2, name: landing.season.title })).toBeTruthy();
    expect(within(page).queryByRole("status")).toBeNull();
  });
});
