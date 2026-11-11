// @vitest-environment jsdom
import { useState } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ConfirmDialog } from "./ConfirmDialog";
import { ActsFoldScope, SideActs } from "./SideActs";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const SEND = COPY.shared.withObject(COPY.account.address.link, "send");
const DISCARD = COPY.shared.verb.discard;
const MORE = COPY.template.more;

beforeEach(() => {
  // A rail's width, where a menu opens as a popover: jsdom has none of the observers the phone's sheet uses.
  vi.spyOn(window, "matchMedia").mockImplementation((media) => Object.assign(new EventTarget(), { media, matches: true }) as MediaQueryList);
});

/** A row's two side acts as a running change's row holds them: the fresh link at once, and the ending behind its question. */
function Acts({ send, folds }: { send: () => void; folds: boolean }) {
  const [isAsking, setAsking] = useState(false);
  return (
    <ActsFoldScope at={folds ? "list" : null}>
      <SideActs
        acts={[
          { label: SEND, onPress: send },
          { label: DISCARD, tone: "danger", onPress: () => setAsking(true) },
        ]}>
        <ConfirmDialog
          verb="discard"
          subject={COPY.account.address.change}
          consequence={COPY.admin.addressChange.previousStays}
          tone="danger"
          onConfirm={() => undefined}
          open={{ isOpen: isAsking, onOpenChange: setAsking }}
        />
      </SideActs>
    </ActsFoldScope>
  );
}

describe("a row's side acts", () => {
  // The harm: a list that folds nothing draws a „⋯“ beside its buttons, an act reachable twice in one row.
  it("are their buttons alone in a list that folds none", () => {
    render(
      <Acts
        send={() => undefined}
        folds={false}
      />,
    );

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toStrictEqual([SEND, DISCARD]);
  });

  // The harm: the menu holds other acts than the row's buttons, or in another order, the destroying one first; or an
  // entry's press runs no act. That the act starts inside the press, which a passkey touch needs, only a browser shows.
  it("stand in the „⋯“ of a list that folds them, in the buttons' order, an entry's press running its act", async () => {
    const send = vi.fn();
    render(
      <Acts
        send={send}
        folds
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: MORE }));
    const entries = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(entries.map((entry) => entry.textContent)).toStrictEqual([SEND, DISCARD]);

    await userEvent.click(entries[0] as HTMLElement);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // The harm: the question an entry opened closes and the keys stand nowhere, the entry that held them gone with its menu.
  it("hand the focus back to the „⋯“ once a question opened from it closes", async () => {
    render(
      <Acts
        send={() => undefined}
        folds
      />,
    );
    const more = screen.getByRole("button", { name: MORE });

    await userEvent.click(more);
    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: DISCARD }));
    const question = await screen.findByRole("alertdialog");
    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.back }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  // The harm: a locked act's entry is one the keys pass over, as a disabled entry is, so nobody on a keyboard or a
  // screen reader learns why the act cannot run; or its press runs the act after all.
  it("keep a locked act's entry in the keys' reach, described by its reason, its press running nothing", async () => {
    const edit = vi.fn();
    render(
      <ActsFoldScope at="card">
        <SideActs
          acts={[
            { label: SEND, onPress: () => undefined },
            { label: DISCARD, locked: COPY.shared.failure.stale, onPress: edit },
          ]}
        />
      </ActsFoldScope>,
    );

    screen.getByRole("button", { name: MORE }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowDown}");
    const locked = within(screen.getByRole("menu")).getByRole("menuitem", { name: DISCARD });
    expect(document.activeElement).toBe(locked);
    const reasons = (locked.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(reasons).toContain(COPY.shared.failure.stale);

    await userEvent.keyboard("{Enter}");
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeDefined();
  });
});
