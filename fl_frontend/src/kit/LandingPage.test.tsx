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
  primary: { label: COPY.page.spielplan, href: ROUTES.spielplan.path("2027") },
  secondary: { label: COPY.page.about, href: ROUTES.about.path() },
  aside: (
    <SaisonBlock
      title={COPY.shared.saisonName("2027")}
      state={{ kind: "running" }}
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
      content={content}
    />
  );
}

/** The document once every boundary has its content. */
async function streamed(page: ReactElement): Promise<HTMLElement> {
  // Every boundary inlined, as a stream does where the content lands before the shell is sent: past React's default
  // chunk the placeholders would leave the content outlined behind a script this document never runs.
  const stream = await renderToReadableStream(page, { progressiveChunkSize: Number.POSITIVE_INFINITY });
  await stream.allReady;
  const root = document.createElement("div");
  root.innerHTML = await new Response(stream).text();
  return root;
}

describe("the landing while its read is on its way", () => {
  // The tagline is the page's title and the lead is known before the read, so both stand outside the wait; the rest
  // is the first screen's placeholders.
  it("stands its tagline and its lead at once, and the placeholders of the rest of the first screen under one status", () => {
    const waiting = document.createElement("div");
    waiting.innerHTML = renderToString(landingWith(new Promise(() => undefined)));
    expect(within(waiting).getByRole("heading", { level: 1 }).textContent).toBe(landing.tagline);
    expect(within(waiting).queryByRole("link")).toBeNull();
    expect(within(waiting).getByText(landing.paragraph)).toBeTruthy();
    expect(
      within(waiting)
        .getAllByRole("status")
        .map((status) => status.textContent),
    ).toStrictEqual([COPY.shared.loading]);
    expect(within(waiting).queryByRole("heading", { level: 2 })).toBeNull();
  });
});

describe("the landing once read", () => {
  it("adds the two ways on, the season's card and the sections, and no placeholder", async () => {
    const page = await streamed(landingWith(Promise.resolve(CONTENT)));
    expect(
      within(page)
        .getAllByRole("link", { name: /./ })
        .map((link) => link.textContent),
    ).toStrictEqual([COPY.page.spielplan, COPY.page.about]);
    expect(within(page).getByRole("heading", { level: 2, name: COPY.shared.saisonName("2027") })).toBeTruthy();
    expect(within(page).getByRole("heading", { level: 2, name: landing.season.title })).toBeTruthy();
    expect(within(page).queryByRole("status")).toBeNull();
  });
});
