// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

  it("takes an error page's retry as its one act, a button that tries again", async () => {
    const onRetry = vi.fn();
    render(
      <StatusPage
        frame="classic"
        mark="error"
        title={error.title}
        sentence={error.sentence}
        next={{ label: error.retry, onRetry }}
      />,
    );
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("link")).toBe(null);
    await userEvent.click(screen.getByRole("button", { name: error.retry }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
