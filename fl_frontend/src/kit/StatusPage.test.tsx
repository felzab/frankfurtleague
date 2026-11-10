// @vitest-environment jsdom
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { StatusPage } from "./StatusPage";

import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/area", useRouter: () => ({ replace: vi.fn() }) }));

/** Two places a person holds, a club's season and the referee's area. */
const CHOICES = [
  { href: "/area/team/6890a1b2c3d4e5f607250011/2526", title: { record: "Goethe-Gymnasium" }, line: { record: "Saison 2526" } },
  { href: "/area/schiedsrichter", title: COPY.shared.schiedsrichter },
] as const;

// The harm: a chooser whose cards lead elsewhere than the place they name sends a person into a place they did not
// pick, or one they do not hold, and the page still looks right.
describe("a rail page whose read lists the reader's places", () => {
  it("draws each place as one link to its own address, named by its title and its line", async () => {
    const { prelude } = await prerender(
      <StatusPage
        frame="rail"
        scope="area"
        title={{ route: "area" }}
        card={Promise.resolve({ choices: CHOICES })}
      />,
      // Every boundary in its place, where React would otherwise leave it for a script no parsed page runs.
      { progressiveChunkSize: Number.MAX_SAFE_INTEGER },
    );
    const page = document.createElement("div");
    page.innerHTML = await new Response(prelude).text();

    // The template draws the strip and its content alone, so every link it writes is a choice.
    const links = [...page.querySelectorAll("a")];
    expect(links.map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
      [CHOICES[0].href, "Goethe-GymnasiumSaison 2526"],
      [CHOICES[1].href, COPY.shared.schiedsrichter],
    ]);
  });
});
