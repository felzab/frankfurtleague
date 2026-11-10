// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { EditorBar } from "./EditorBar";

import type { FormStatus } from "./useFormAction";

// The bar's question reads Next's router, which no test mounts.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const TEXT = COPY.shared.startelf;
const CHANGES = COPY.template.changesPending(2);

function Bar({ status }: { status: FormStatus }) {
  return (
    <EditorBar
      status={status}
      text={TEXT}
      isPending={false}
      question={{ asked: null, confirm: () => undefined, decline: () => undefined }}
      onSave={() => undefined}
    />
  );
}

// The harm either way round: the page's text standing beside „Gespeichert“ or over a refusal, which then nobody reads,
// or gone for good after the first save, on the one page whose bar is where its counts stand.
describe("the bar's line on a page with a text of its own", () => {
  it("hands the line to a save's outcome, announced from the region that stood empty, and takes it back at the next edit", () => {
    const { rerender } = render(<Bar status={null} />);
    const region = screen.getByRole("status");
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(region.textContent).toBe("");

    rerender(<Bar status={{ tone: "changes", text: CHANGES }} />);
    // The text first, the count after it, and neither spoken on every edit.
    expect(screen.getByText(TEXT).nextElementSibling?.textContent).toBe(CHANGES);
    expect(region.textContent).toBe("");

    for (const outcome of [COPY.shared.saved, COPY.shared.failure.stale]) {
      rerender(<Bar status={{ tone: outcome === COPY.shared.saved ? "saved" : "error", text: outcome }} />);
      expect(screen.queryByText(TEXT)).toBeNull();
      expect(screen.queryByText(CHANGES)).toBeNull();
      // The same node as before the outcome: a region mounted with its words already in it is not announced.
      expect(screen.getByRole("status")).toBe(region);
      expect(region.textContent).toBe(outcome);
    }

    rerender(<Bar status={{ tone: "changes", text: CHANGES }} />);
    expect(screen.getByText(TEXT)).toBeTruthy();
    expect(region.textContent).toBe("");
  });
});
