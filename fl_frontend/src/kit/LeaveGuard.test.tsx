// @vitest-environment jsdom
import { act, getDefaultNormalizer, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { useHoldLeave } from "./LeaveGuard";
import { RailFrame } from "./RailFrame";
import { WholePages } from "./WholePage";

import type NextLink from "next/link";
import type { ComponentProps } from "react";

// Next's link as its reference documents `onNavigate`: a same-site press calls it, and its `preventDefault` cancels the
// link's own navigation, which this double never makes.
vi.mock("next/link", async (original) => ({
  ...(await original<object>()),
  default: ({
    href,
    onNavigate,
    prefetch: _prefetch,
    replace: _replace,
    scroll: _scroll,
    children,
    ...props
  }: ComponentProps<typeof NextLink>) => (
    <a
      {...props}
      href={String(href)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.({ preventDefault: () => undefined });
      }}>
      {children}
    </a>
  ),
}));

/** An editor's page holding `count` unsaved changes, as `useEditor` holds its draft's. */
function Draft({ count, discard }: { count: number; discard: () => void }) {
  useHoldLeave(count, discard);
  return <p>Entwurf</p>;
}

/** The rail frame of a one-entry area around the draft, its entry leading to the Spielorte. */
async function renderFrame(count: number) {
  const push = vi.fn();
  const discard = vi.fn();
  await act(async () =>
    renderUnderNext(
      <WholePages>
        <RailFrame
          groups={[{ entries: [{ id: "spielorte", label: COPY.page.adminSpielorte, href: "/admin/spielorte", icon: "search" }] }]}
          bar={["spielorte"]}
          foot={{ kind: "signIn", href: "/signin" }}>
          <Draft
            count={count}
            discard={discard}
          />
        </RailFrame>
      </WholePages>,
      {
        router: {
          back: () => undefined,
          forward: () => undefined,
          refresh: () => undefined,
          push,
          replace: push,
          prefetch: () => undefined,
          bfcacheId: "",
        },
        pathname: "/admin/vereine",
        params: {},
      },
    ),
  );
  // The rail's entry, which a desktop presses; the phone bar's place is the same link.
  const [entry] = screen.getAllByRole("link", { name: COPY.page.adminSpielorte });
  if (entry === undefined) throw new Error("the rail draws no entry");
  return { push, discard, entry };
}

// The harm: on a desktop an editor's unsaved input is lost without a question when the person presses a rail entry,
// the season button or the account menu, each a link of the kit, and nothing on the page says it was ever there.
describe("a link out of an editor", () => {
  it("asks before it drops the editor's unsaved changes, and leaves only once the person discards them", async () => {
    const { push, discard, entry } = await renderFrame(2);

    await userEvent.click(entry);
    const question = await screen.findByRole("alertdialog");
    within(question).getByText(COPY.template.changesLost(2), { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) });
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(within(question).getByRole("button", { name: COPY.shared.verb.discard }));
    expect(discard).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/admin/spielorte", { scroll: true });
  });

  it("leaves at once where nothing is unsaved", async () => {
    const { push, entry } = await renderFrame(0);

    await userEvent.click(entry);

    expect(push).toHaveBeenCalledWith("/admin/spielorte", { scroll: true });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
