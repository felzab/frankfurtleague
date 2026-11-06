// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { BulkAccept } from "./BulkAccept";

import type { FLBewerbungListRow } from "@/core/generated/client/types";

const ADDRESS = "/admin/saisons/2027/bewerbungen/bulk";

vi.mock("../[bewerbung]/decideBewerbung", () => ({ acceptBewerbung: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => ADDRESS,
  useRouter: () => ({ refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const row = (id: string, name: string) =>
  ({
    id,
    name,
    version: 1,
    shorthand: "ABC",
    submitted_at: "2026-11-01",
    stufengroesse: 100,
    expected_kader: 16,
    wunschfarbe: "rot",
    wunschgegner: null,
    people: 1,
  }) as FLBewerbungListRow;

const run = () => (
  <BulkAccept
    saison="2027"
    rows={[row("a", "Goethe-Gymnasium"), row("b", "Schiller-Schule")]}
    gruppen={[{ gruppe: "A", free: 4 }]}
    rules={{ required: { gruppe: true, trikot_farbe: true } }}
  />
);

/** Back, as the browser answers it: the address first, then the popstate the router's hooks read. */
async function pressBack() {
  const landed = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
  window.history.back();
  await landed;
}

beforeEach(() => {
  window.history.replaceState(null, "", ADDRESS);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// jsdom lays nothing out and a run has no address of its own in a journey, so neither walk is seen anywhere else.
describe("walking a Sammel-Zusage's cards", () => {
  it("opens the next card at the page's top, a phone's scroll standing wherever the last card left it", async () => {
    render(run());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.skip }));

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("takes Back from the second card to the first, the run having opened on the bare address", async () => {
    const { rerender } = render(run());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.skip }));
    rerender(run());
    expect(screen.getByText("Schiller-Schule")).toBeTruthy();

    await pressBack();
    rerender(run());

    expect(screen.getByText("Goethe-Gymnasium")).toBeTruthy();
    expect(screen.getByText(COPY.admin.bewerbung.cardOf(1, 2))).toBeTruthy();
  });
});
