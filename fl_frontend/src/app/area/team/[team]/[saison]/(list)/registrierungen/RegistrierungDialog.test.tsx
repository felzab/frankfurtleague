// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { admitRegistrierung, declineRegistrierung } from "./decideRegistrierung";
import { RegistrierungDialog } from "./RegistrierungDialog";

import type { Admission } from "./RegistrierungDialog";

vi.mock("./decideRegistrierung", () => ({
  admitRegistrierung: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  declineRegistrierung: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
}));

const PIA = "cccccccccccccccccccccccc";
const KNOWN = "dddddddddddddddddddddddd";

/** The dialog of Pia's registration, open, admitting as `admission` says. */
function opened(admission: Admission) {
  renderUnderNext(
    <RegistrierungDialog
      entry={{ decided: { registrierung_id: PIA }, name: "Pia Sander", facts: [], admission }}
      open={{ isOpen: true, onOpenChange: () => undefined }}
    />,
  );
  return within(screen.getByRole("dialog"));
}

afterEach(() => {
  vi.clearAllMocks();
});

// Each press posts the ids the page bound when it drew the row; a slip sends a decision for a pupil nobody pressed,
// which the backend admits as readily, and the list only shows the wrong row gone.
describe("a registration's dialog", () => {
  it("admits its own registration, into the person its entry names", async () => {
    await userEvent.click(opened({ kind: "once", spieler_id: KNOWN }).getByRole("button", { name: COPY.shared.verb.admit }));

    await waitFor(() => expect(vi.mocked(admitRegistrierung).mock.calls).toStrictEqual([[{ registrierung_id: PIA, spieler_id: KNOWN }]]));
  });

  it("declines its own registration once asked, naming its pupil in the question", async () => {
    const dialog = opened({ kind: "once", spieler_id: null });
    await userEvent.click(dialog.getByRole("button", { name: COPY.shared.verb.decline }));
    const question = within(await screen.findByRole("alertdialog"));
    expect(question.getByText("Pia Sander")).toBeTruthy();
    await userEvent.click(question.getByRole("button", { name: COPY.shared.verb.decline }));

    await waitFor(() => expect(vi.mocked(declineRegistrierung).mock.calls).toStrictEqual([[{ registrierung_id: PIA, reason: null }]]));
    expect(admitRegistrierung).not.toHaveBeenCalled();
  });

  it("answers the same-person question: the other person's answer declines the registration as another person", async () => {
    const dialog = opened({ kind: "asks", spieler_id: KNOWN, name: "Pia Sandner" });
    await userEvent.click(dialog.getByRole("radio", { name: AREA_COPY.team.registrierung.otherPerson }));
    await userEvent.click(dialog.getByRole("button", { name: COPY.shared.verb.admit }));

    await waitFor(() =>
      expect(vi.mocked(declineRegistrierung).mock.calls).toStrictEqual([[{ registrierung_id: PIA, reason: "other_person" }]]),
    );
    expect(admitRegistrierung).not.toHaveBeenCalled();
  });
});
