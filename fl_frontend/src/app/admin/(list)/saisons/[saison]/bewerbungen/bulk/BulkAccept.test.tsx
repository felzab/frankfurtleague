// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { acceptBewerbung } from "@/features/bewerbungen/acceptBewerbung";
import { renderUnderNext } from "@/test-support/nextContexts";

import { BulkAccept } from "./BulkAccept";

import type { FLBewerbungListRow } from "@/core/generated/client/types";
import type { NextContexts } from "@/test-support/nextContexts";

const ADDRESS = "/admin/saisons/2027/bewerbungen/bulk";

vi.mock("@/features/bewerbungen/acceptBewerbung", () => ({ acceptBewerbung: vi.fn() }));
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
    rules={{}}
  />
);

beforeEach(() => {
  window.history.replaceState(null, "", ADDRESS);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
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
      expect(within(rowOf(school)).queryAllByText(ADMIN_COPY.bewerbung.complete)).not.toHaveLength(0);
    }
  });
});

// The harm: a card reopened from its refused row without the fault on its box, so nothing says which box to change.
describe("a card reopened for its refusal", () => {
  it("stands with the fault on its box", async () => {
    vi.mocked(acceptBewerbung)
      .mockResolvedValueOnce({ ok: false, fieldErrors: { trikot_farbe: COPY.shared.field.taken } })
      .mockResolvedValueOnce({ ok: true, value: undefined });
    const { rerender } = renderUnderNext(run(), atThePage);
    for (const _card of ["a", "b"]) {
      await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.next }));
      rerender(run());
    }
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(ADMIN_COPY.bewerbung.count(2), "accept") }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.accept }));
    await waitFor(() => expect(acceptBewerbung).toHaveBeenCalledTimes(2));

    await userEvent.click(await screen.findByRole("button", { name: "Goethe-Gymnasium" }));
    rerender(run());

    expect(await screen.findByText(COPY.shared.field.taken)).toBeTruthy();
  });
});
