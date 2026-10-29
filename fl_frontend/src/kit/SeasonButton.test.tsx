// @vitest-environment jsdom
import { Suspense } from "react";

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Session 8: from `react-aria-components` once HeroUI goes, as in `RootProviders.tsx`.
import { RouterProvider } from "@heroui/react/rac";

import { COPY } from "@/core/copy";

import { counterpart, SeasonScope } from "./FrameNav";
import { SeasonButton } from "./SeasonButton";

import type { SeasonPage, Seasons } from "./FrameNav";

// The address the page answers at, as Next's hooks read it on the client.
const address = vi.hoisted(() => ({ path: "/", params: {} as Record<string, string> }));
vi.mock("next/navigation", () => ({
  usePathname: () => address.path,
  useParams: () => address.params,
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

const PUBLIC: readonly SeasonPage[] = ["spielplan"];
const VERWALTUNG: readonly SeasonPage[] = ["verwaltungUebersicht", "verwaltungSpiele", "verwaltungTeams"];

describe("the same page in the other season", () => {
  it("swaps the season in a season page's address", () => {
    expect(counterpart({ path: "/saisons/2027", params: { saison: "2027" }, to: "2026", home: "spielplan", pages: PUBLIC })).toBe(
      "/saisons/2026",
    );
    expect(
      counterpart({
        path: "/bereich/verwaltung/saisons/2027/teams",
        params: { saison: "2027" },
        to: "2026",
        home: "verwaltungUebersicht",
        pages: VERWALTUNG,
      }),
    ).toBe("/bereich/verwaltung/saisons/2026/teams");
  });

  it("lands a record's page, which has no counterpart, on the list it lies under", () => {
    expect(
      counterpart({ path: "/saisons/2027/spiele/abc", params: { saison: "2027", spiel: "abc" }, to: "2026", home: "spielplan", pages: PUBLIC }),
    ).toBe("/saisons/2026");
    expect(
      counterpart({
        path: "/bereich/verwaltung/saisons/2027/spiele/abc",
        params: { saison: "2027", spiel: "abc" },
        to: "2026",
        home: "verwaltungUebersicht",
        pages: VERWALTUNG,
      }),
    ).toBe("/bereich/verwaltung/saisons/2026/spiele");
  });

  it("lands a page whose address names no season on the season's first page", () => {
    expect(
      counterpart({ path: "/bereich/verwaltung/spielorte", params: {}, to: "2026", home: "verwaltungUebersicht", pages: VERWALTUNG }),
    ).toBe("/bereich/verwaltung/saisons/2026");
  });
});

const SEASONS: Seasons = {
  entries: [
    { id: "2027", span: "01.09.2026 – 30.06.2027" },
    { id: "2026", span: "01.09.2025 – 30.06.2026" },
  ],
  standard: "2026",
};

/** The season button in a frame holding these seasons, its seasons settled. */
async function renderButton(
  seasons: Seasons | null,
  navigate: (href: string, options?: { replace?: boolean }) => void = () => undefined,
  placement: "rail" | "band" = "rail",
) {
  await act(async () => {
    render(
      <RouterProvider navigate={navigate}>
        <SeasonScope value={{ seasons: Promise.resolve(seasons), home: "verwaltungUebersicht", pages: VERWALTUNG }}>
          <Suspense fallback={null}>
            <SeasonButton placement={placement} />
          </Suspense>
        </SeasonScope>
      </RouterProvider>,
    );
  });
}

describe("the season button", () => {
  beforeEach(() => {
    // The rail's width, where the menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
    vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
    address.path = "/bereich/verwaltung/saisons/2027/spiele/abc";
    address.params = { saison: "2027", spiel: "abc" };
  });

  it("names the season the address names and offers each season's counterpart of the page shown", async () => {
    await renderButton(SEASONS);

    await userEvent.click(screen.getByRole("button", { name: new RegExp(COPY.shared.saisonName("2027")) }));

    expect(screen.getByRole("menuitemradio", { name: COPY.shared.saisonName("2026") }).getAttribute("href")).toBe(
      "/bereich/verwaltung/saisons/2026/spiele",
    );
    expect(screen.getByRole("menuitemradio", { name: COPY.shared.saisonName("2027") }).getAttribute("aria-checked")).toBe("true");
  });

  it("switches by replacing the page in the history, so Back skips the switch", async () => {
    const navigate = vi.fn();
    await renderButton(SEASONS, navigate);

    await userEvent.click(screen.getByRole("button", { name: new RegExp(COPY.shared.saisonName("2027")) }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: COPY.shared.saisonName("2026") }));

    expect(navigate).toHaveBeenCalledWith("/bereich/verwaltung/saisons/2026/spiele", { replace: true });
  });

  it("names the frame's standard season on a page whose address names none", async () => {
    address.path = "/bereich/verwaltung/spielorte";
    address.params = {};
    await renderButton(SEASONS);

    expect(screen.getByRole("button", { name: new RegExp(COPY.shared.saisonName("2026")) })).toBeTruthy();
  });

  it("shows the season's span under its name in the rail, and the name alone on the band", async () => {
    await renderButton(SEASONS);
    expect(screen.getByRole("button", { name: new RegExp(COPY.shared.saisonName("2027")) }).textContent).toBe(
      `${COPY.shared.saisonName("2027")}01.09.2026 – 30.06.2027`,
    );

    cleanup();
    await renderButton(SEASONS, () => undefined, "band");
    expect(screen.getByRole("button", { name: COPY.shared.saisonName("2027") }).textContent).toBe(COPY.shared.saisonName("2027"));
  });

  it("stands nowhere while the person has no season", async () => {
    await renderButton(null);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
