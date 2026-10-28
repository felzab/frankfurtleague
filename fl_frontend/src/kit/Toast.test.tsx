// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { appToast, ToastRegion } from "./Toast";

// React Aria portals a toast region into the document's body, where none of the frame's measures that place
// it are declared: a toast standing there sits below the screen, which no check would notice.
it("draws a raised toast inside the frame that mounts the region, whose measures place it", async () => {
  const { container } = render(<ToastRegion frame="rail" />);

  act(() => appToast("danger", COPY.shared.toast.fehler));

  expect(container.contains(await screen.findByText(COPY.shared.toast.fehler))).toBe(true);
});
