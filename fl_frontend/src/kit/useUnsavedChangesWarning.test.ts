// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useUnsavedChangesWarning } from "./useUnsavedChangesWarning";

/** Whether the browser would ask before the unload: nothing on the page shows it until somebody loses a draft. */
const asks = (): boolean => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));

describe("the question before an unload", () => {
  it("stands while something is unsaved, and for no longer", () => {
    const { rerender, unmount } = renderHook(({ isDirty }) => useUnsavedChangesWarning(isDirty), { initialProps: { isDirty: false } });
    expect(asks()).toBe(false);

    rerender({ isDirty: true });
    expect(asks()).toBe(true);

    rerender({ isDirty: false });
    expect(asks()).toBe(false);

    rerender({ isDirty: true });
    unmount();
    expect(asks()).toBe(false);
  });
});
