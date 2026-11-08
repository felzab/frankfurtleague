// @vitest-environment jsdom
import { act } from "react";

import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftRail } from "./DraftRail";
import { DraftStatusProvider } from "./DraftStatusContext";

import type { FLDraftStatus } from "@/shared/utils/draftStatus";

const answers = (matches: boolean) =>
  vi
    .spyOn(window, "matchMedia")
    .mockImplementation((media) => Object.assign(new EventTarget(), { media, matches }) as unknown as MediaQueryList);

const RAIL = (
  <DraftStatusProvider status={{ changed: [] } as unknown as FLDraftStatus<string>}>
    <DraftRail
      banners={[]}
      nomen="Spielbericht"
    />
  </DraftStatusProvider>
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the rail's folds", () => {
  // The harm: a fold's first state read from the window differs from the server's markup, so React discards the page's
  // markup on every load, at the width where they differ, and says so only in a console no reader opens.
  it.each([
    ["a phone", false],
    ["a wide screen", true],
  ])("hydrate on %s without a mismatch, then stand as that width has them", async (_width, isColumn) => {
    answers(!isColumn);
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(RAIL);
    answers(isColumn);
    const onRecoverableError = vi.fn();

    await act(async () => {
      hydrateRoot(container, RAIL, { onRecoverableError });
      await Promise.resolve();
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent?.includes("Keine Hinweise.")).toBe(isColumn);
  });
});
