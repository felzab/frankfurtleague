// @vitest-environment jsdom
import { ListQueryScope } from "@/kit/ListTable";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { deregisterKaderRow, saveKaderRow } from "./kaderRowActs";
import { KaderTable } from "./KaderTable";

import type { FLKaderRow } from "@/core/generated/client/types";

vi.mock("./kaderRowActs", () => ({
  saveKaderRow: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  deregisterKaderRow: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const TEAM = "6af32ed4205642a3fd5ee7e1";
const SAISON = "2027";

const row = (
  spieler_id: string,
  first_name: string,
  nummer: string | null,
  rolle: FLKaderRow["rolle"],
  version: number,
  out = false,
): FLKaderRow => ({
  spieler_id,
  first_name,
  last_name: "Bauer",
  nummer,
  nummer_double: false,
  position: "Abwehr",
  stufe: "Q2",
  rolle,
  is_nachnominiert: false,
  inactive_since: out ? "2026-11-01" : null,
  version,
});

// The read's order is by name; the page lists by shirt number, so a row's place on the page is not its place in the read.
const KADER = [
  row("64b000000000000000000001", "Anna", "11", "kapitaen", 3),
  row("64b000000000000000000002", "Ben", "4", null, 7),
  row("64b000000000000000000003", "Carla", "8", "co_kapitaen", 2, true),
];

function drawn() {
  return render(
    <ListQueryScope>
      <KaderTable
        head={{ nameLabel: COPY.shared.name, columns: [] }}
        read={{ team_id: TEAM, saison_id: SAISON, allowed_stufen: ["Q1", "Q2"], kader: KADER }}
        team={TEAM}
        saison={SAISON}
      />
    </ListQueryScope>,
  );
}

/** The dialog a row's press opened. */
async function openRow(name: string) {
  // Found rather than got: the page stays hidden from the tree until a closing dialog has left.
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("the Kader's dialog", () => {
  // The harm: a save or an „Austragen“ landing on another player than the one whose row was pressed, the list being in
  // another order than the read, and nothing on the page saying which row the backend changed.
  it("sends its save and its „Austragen“ for the row pressed, on that row's version", async () => {
    drawn();
    const dialog = await openRow("Ben Bauer");
    expect(within(dialog).getByRole("heading").textContent).toBe("Ben Bauer");

    await userEvent.click(within(dialog).getByRole("button", { name: COPY.shared.verb.save }));
    const sent = vi.mocked(saveKaderRow).mock.calls[0]?.[0] as FormData;
    expect([sent.get("team_id"), sent.get("saison_id"), sent.get("spieler_id"), sent.get("version")]).toStrictEqual([
      TEAM,
      SAISON,
      "64b000000000000000000002",
      "7",
    ]);

    const again = await openRow("Ben Bauer");
    await userEvent.click(within(again).getByRole("button", { name: COPY.shared.verb.deregister }));
    const question = await screen.findByRole("alertdialog");
    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.verb.deregister }));
    expect(vi.mocked(deregisterKaderRow)).toHaveBeenCalledWith({ team_id: TEAM, saison_id: SAISON, spieler_id: "64b000000000000000000002" });
  });
});
