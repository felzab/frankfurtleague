// @vitest-environment jsdom
import { startTransition, Suspense, use, useState } from "react";

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { renderUnderNext } from "@/test-support/nextContexts";

import { RailCardBody, StatusCardBody } from "./StatusCard";

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

// A retry is a server round trip, pressed mostly while the backend is down, and a press showing nothing until the same
// card comes back reads as a press that did nothing; nobody presses it before a page fails in earnest.
describe("an error card's retry", () => {
  it("stays busy until the refreshed route is drawn", async () => {
    const refreshed = Promise.withResolvers<string>();
    // The route as Next's router holds it: its state a promise while a refresh runs, read with `use`, and the
    // boundary's `retry` setting it inside a transition of its own beside clearing the error.
    function Route() {
      const [state, setState] = useState<Promise<string> | string>("");
      const [failed, setFailed] = useState(true);
      const shown = typeof state === "string" ? state : use(state);
      if (!failed) return <p>{shown}</p>;
      return (
        <StatusCardBody
          tone="danger"
          next={{
            retry: () =>
              startTransition(() => {
                startTransition(() => setState(refreshed.promise));
                setFailed(false);
              }),
          }}
        />
      );
    }
    renderUnderNext(
      <Suspense>
        <Route />
      </Suspense>,
    );

    // Awaited inside `act`, so the suspended render's retry is React's to schedule once the refresh answers.
    await act(() => userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retry })));
    expect(screen.getByRole("progressbar", { name: COPY.shared.loading })).toBeTruthy();

    await act(async () => refreshed.resolve("gelesen"));
    expect(await screen.findByText("gelesen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: COPY.shared.verb.retry })).toBeNull();
  });
});
