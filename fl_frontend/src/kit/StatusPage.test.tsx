// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { StatusCard, StatusPage } from "./StatusPage";

const { notFound } = SERVER_COPY.landing;
const { error } = COPY.landing.status;

describe("a status card", () => {
  it("writes no landmark of its own, so a page inside an old shell's main places it without a second one", () => {
    render(
      <main>
        <StatusCard
          mark="info"
          title={notFound.title}
          sentence={notFound.sentence}
          next={{ label: COPY.shared.end.toHome, href: "/" }}
        />
      </main>,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: COPY.shared.end.toHome }).getAttribute("href")).toBe("/");
  });

  // D481: an error page offers the way to the start page, never a retry.
  it("leads an error page's card to the start page, in the one landmark the classic frame writes", () => {
    render(
      <StatusPage
        frame="classic"
        mark="error"
        title={error.title}
        sentence={error.sentence}
        next={{ label: COPY.shared.end.toHome, href: "/" }}
      />,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("link", { name: COPY.shared.end.toHome }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button")).toBe(null);
  });
});
