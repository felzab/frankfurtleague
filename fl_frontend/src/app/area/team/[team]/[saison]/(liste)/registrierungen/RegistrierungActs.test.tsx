// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { admitRegistrierung, declineRegistrierung } from "./decideRegistrierung";
import { RegistrierungActs } from "./RegistrierungActs";

import type { Admission } from "./RegistrierungActs";

vi.mock("./decideRegistrierung", () => ({
  admitRegistrierung: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  declineRegistrierung: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const AT = { team_id: "aaaaaaaaaaaaaaaaaaaaaaaa", saison_id: "2027" };
const OLE = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PIA = "cccccccccccccccccccccccc";
const KNOWN = "dddddddddddddddddddddddd";

/** One row's acts, each in a group named by its row as the table's row names its acts. */
const row = (registrierung_id: string, name: string, admission: Admission) => (
  <div
    role="group"
    aria-label={name}>
    <RegistrierungActs
      decided={{ ...AT, registrierung_id }}
      admission={admission}
      name={name}
      mailed
    />
  </div>
);

const actsOf = (name: string) => within(screen.getByRole("group", { name }));

afterEach(() => {
  vi.clearAllMocks();
});

// Each press posts ids the page bound when it drew the row; a slip sends a decision for a pupil nobody pressed, which
// the backend admits as readily, and the list only shows the wrong row gone.
describe("a registration's acts", () => {
  it("send the admission and the decline for their own row, into the person the row names", async () => {
    render(
      <>
        {row(OLE, "Ole Sommer", { kind: "once", spieler_id: KNOWN })}
        {row(PIA, "Pia Sander", { kind: "once", spieler_id: null })}
      </>,
    );

    await userEvent.click(actsOf("Pia Sander").getByRole("button", { name: COPY.shared.verb.admit }));
    await userEvent.click(actsOf("Ole Sommer").getByRole("button", { name: COPY.shared.verb.admit }));
    await userEvent.click(actsOf("Pia Sander").getByRole("button", { name: COPY.shared.verb.decline }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.decline }));

    expect(vi.mocked(admitRegistrierung).mock.calls).toStrictEqual([
      [{ ...AT, registrierung_id: PIA, spieler_id: null }],
      [{ ...AT, registrierung_id: OLE, spieler_id: KNOWN }],
    ]);
    expect(vi.mocked(declineRegistrierung).mock.calls).toStrictEqual([[{ ...AT, registrierung_id: PIA, reason: null }]]);
  });

  it("answers the same-person question for its own row: the known person admitted, the other declined as another person", async () => {
    render(row(OLE, "Mehmet Yilmaz", { kind: "asks", spieler_id: KNOWN, name: "Mert Yilmaz" }));
    const ask = async () => {
      await userEvent.click(actsOf("Mehmet Yilmaz").getByRole("button", { name: COPY.shared.verb.admit }));
      return within(screen.getByRole("dialog"));
    };

    await userEvent.click((await ask()).getByRole("button", { name: COPY.shared.verb.confirm }));
    // The question closes in a transition, which may commit after the press returns; while it stands, the row under it
    // is hidden from every query.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const second = await ask();
    await userEvent.click(second.getByRole("radio", { name: COPY.area.team.registrierung.otherPerson }));
    await userEvent.click(second.getByRole("button", { name: COPY.shared.verb.confirm }));

    expect(vi.mocked(admitRegistrierung).mock.calls).toStrictEqual([[{ ...AT, registrierung_id: OLE, spieler_id: KNOWN }]]);
    expect(vi.mocked(declineRegistrierung).mock.calls).toStrictEqual([[{ ...AT, registrierung_id: OLE, reason: "other_person" }]]);
  });

  // A locked button looks pressable to a pointer's eye alone; only a press shows whether it still acts.
  it("admits nothing from a locked „Aufnehmen“, which says its reason instead", async () => {
    render(row(OLE, "Ole Sommer", { kind: "locked", reason: COPY.area.team.registrierung.kaderFull }));
    const admit = actsOf("Ole Sommer").getByRole("button", { name: COPY.shared.verb.admit });

    await userEvent.click(admit);

    expect(admitRegistrierung).not.toHaveBeenCalled();
    expect(admit.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText(COPY.area.team.registrierung.kaderFull).length).toBeGreaterThan(0);
  });
});
