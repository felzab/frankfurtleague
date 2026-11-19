// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { renderUnderNext } from "@/test-support/nextContexts";

import { acceptBewerbung } from "../[bewerbung]/decideBewerbung";
import { BulkAccept } from "./BulkAccept";

import type { FLBewerbungListRow } from "@/core/generated/client/types";
import type { NextContexts } from "@/test-support/nextContexts";

const ADDRESS = "/admin/saisons/2027/bewerbungen/bulk";

vi.mock("../[bewerbung]/decideBewerbung", () => ({ acceptBewerbung: vi.fn() }));
/** Next's navigation at the page, its search as the steps leave it at each render. */
const atThePage = (): NextContexts => ({ pathname: ADDRESS, search: window.location.search });

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
    status: "submitted",
    seats_confirmed: 3,
  }) as FLBewerbungListRow;

const run = () => (
  <BulkAccept
    saison="2027"
    rows={[row("a", "Goethe-Gymnasium"), row("b", "Schiller-Schule")]}
    gruppen={[{ gruppe: "A", free: 4 }]}
    taken={[]}
    rules={{ required: { gruppe: false, trikot_farbe: false } }}
  />
);

beforeEach(() => {
  window.history.replaceState(null, "", ADDRESS);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The run stands in a rail page whose strip holds the page's `h1`: a second one would name the page twice in the outline
// a screen reader walks.
describe("a finished Sammel-Zusage", () => {
  it("names its end a rung below the strip's title", async () => {
    vi.mocked(acceptBewerbung).mockResolvedValue({ ok: true, value: undefined });
    renderUnderNext(
      <BulkAccept
        saison="2027"
        rows={[row("a", "Goethe-Gymnasium")]}
        gruppen={[{ gruppe: "A", free: 4 }]}
        taken={[]}
        rules={{ required: { gruppe: false, trikot_farbe: false } }}
      />,
      atThePage,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next }));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(COPY.admin.bewerbung.count(1), "accept") }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.accept }));

    expect((await screen.findByRole("heading", { name: COPY.admin.bewerbung.acceptedCount(1) })).tagName).toBe("H2");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

// Every row of a „Stand“ column states a value, and a row the run has not written yet has no outcome to draw it from:
// nothing but this case reads that cell before the run's one confirm.
describe("the check page's „Stand“ column", () => {
  it("states each application's standing before the run writes it", async () => {
    const { rerender } = renderUnderNext(run(), atThePage);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next }));
    rerender(run());
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next }));
    rerender(run());

    const rowOf = (school: string) => screen.getByText(school).closest("tr") as HTMLElement;
    for (const school of ["Goethe-Gymnasium", "Schiller-Schule"]) {
      expect(within(rowOf(school)).queryAllByText(COPY.admin.bewerbung.complete)).not.toHaveLength(0);
    }
  });
});
