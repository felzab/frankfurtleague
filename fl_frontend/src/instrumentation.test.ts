import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { HOUR_MS } from "@/core/timeUnits";
import { serveBackend } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";

/* Every job the scheduler would run is the real one, over a backend that answers nothing: a pass armed here would send
   its first request into a case that names none, which fails it, and be on the record of what the backend saw. */
const backend = serveBackend();
const log = captureLog();

const { register } = await import("./instrumentation");

beforeEach(() => void vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/* The boot arms the scheduler under a production build's `NODE_ENV` alone, so a test that boots the frontend sends no
   pass. The case states the suite's own value rather than taking whichever the project running it sets. */
it("arms nothing under the NODE_ENV test", async () => {
  vi.stubEnv("NODE_ENV", "test");
  await register();
  vi.advanceTimersByTime(3 * HOUR_MS);
  await backend.answered();

  expect(backend.sent, "a pass reached the backend").toStrictEqual([]);
  // The boot ran to its end, so the silence is the scheduler's.
  expect(log.lines().map(({ message }) => message)).toStrictEqual(["system.started"]);
});
