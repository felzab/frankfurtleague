import { vi } from "vitest";

/**
 * `AbortSignal.timeout` on the global `setTimeout`, so Vitest's fake timers drive it: Node's own runs on an internal timer
 * the fakes never reach. Called after `vi.useFakeTimers`, and taken back by `vi.restoreAllMocks`.
 */
export function timeoutSignalsOnFakeTimers(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("The operation was aborted due to timeout.", "TimeoutError")), ms);
    return controller.signal;
  });
}
