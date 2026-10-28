// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link } from "react-aria-components/Link";
import { describe, expect, it, vi } from "vitest";

import { RootProviders } from "./RootProviders";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("a React Aria link's navigation", () => {
  it("adds a history entry by default, and replaces the current one where the link asks", async () => {
    render(
      <RootProviders>
        <Link href="/saisons/2027">Weiter</Link>
        <Link
          href="/saisons/2026"
          routerOptions={{ replace: true }}>
          Saison 2026
        </Link>
      </RootProviders>,
    );

    await userEvent.click(screen.getByText("Weiter"));
    expect(router.push).toHaveBeenCalledWith("/saisons/2027", {});
    expect(router.replace).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("Saison 2026"));
    expect(router.replace).toHaveBeenCalledWith("/saisons/2026", {});
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});
