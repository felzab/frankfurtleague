// @vitest-environment jsdom
import { getDefaultNormalizer, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { acceptBewerbung } from "../[bewerbung]/decideBewerbung";
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

const run = (taken: readonly string[] = []) => (
  <BulkAccept
    saison="2027"
    rows={[row("a", "Goethe-Gymnasium"), row("b", "Schiller-Schule")]}
    gruppen={[{ gruppe: "A", free: 4 }]}
    taken={taken}
    rules={{ required: { gruppe: false, trikot_farbe: false } }}
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
    expect(
      screen.getByText(COPY.admin.bewerbung.cardOf(1, 2), { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) }),
    ).toBeTruthy();
  });
});

// The run stands in a rail page whose strip holds the page's `h1`: a second one would name the page twice in the outline
// a screen reader walks.
describe("a finished Sammel-Zusage", () => {
  it("names its end a rung below the strip's title", async () => {
    vi.mocked(acceptBewerbung).mockResolvedValue({ ok: true, value: undefined });
    render(
      <BulkAccept
        saison="2027"
        rows={[row("a", "Goethe-Gymnasium")]}
        gruppen={[{ gruppe: "A", free: 4 }]}
        taken={[]}
        rules={{ required: { gruppe: false, trikot_farbe: false } }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next }));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(COPY.admin.bewerbung.count(1), "accept") }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.accept }));

    expect((await screen.findByRole("heading", { name: COPY.admin.bewerbung.acceptedCount(1) })).tagName).toBe("H2");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

const colourBox = () => screen.getByRole("button", { name: new RegExp(COPY.team.trikotFarbe) });

// The write refuses a taken colour at the end of the run, on a card long left behind.
describe("a colour a card may not take", () => {
  it("closes a taken colour and opens on none where the wish is taken", async () => {
    render(run(["rot"]));
    expect(colourBox().textContent).toContain(COPY.shared.notProvided);

    await userEvent.click(colourBox());
    expect(screen.getByRole("option", { name: "Rot" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("opens on the wish while it stands free", () => {
    render(run());
    expect(colourBox().textContent).toContain("Rot");
  });

  it("counts an earlier card's pick, the card itself keeping its own", async () => {
    const { rerender } = render(run());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next }));
    rerender(run());

    // The second card wishes the colour the first one took.
    expect(screen.getByText("Schiller-Schule")).toBeTruthy();
    expect(colourBox().textContent).toContain(COPY.shared.notProvided);
  });
});
