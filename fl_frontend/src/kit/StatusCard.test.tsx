// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { renderUnderNext } from "@/test-support/nextContexts";

import { RailCardBody } from "./StatusCard";

// A rail card stands under the strip, which holds the page's `h1`: a second one would name the page twice in the
// outline a screen reader walks, which no sighted reader sees.
describe("a rail page's status card", () => {
  it("names its end a rung below the strip's title", () => {
    renderUnderNext(
      <RailCardBody
        card={{
          tone: "danger",
          title: COPY.shared.failure.unexpected,
          next: { label: COPY.shared.end.toOverview, href: ROUTES.admin.path() },
        }}
        scope="area"
      />,
    );

    expect(screen.getByRole("heading", { name: COPY.shared.failure.unexpected }).tagName).toBe("H2");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
