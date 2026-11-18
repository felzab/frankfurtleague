import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { serveBackend } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";

/* Every job the scheduler would run is the real one, over a backend that answers nothing: a pass armed here would send
   its first request into a case that names none, which fails it, and be on the record of what the backend saw. */
const backend = serveBackend();
const log = captureLog();

const { register } = await import("./instrumentation");

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => void vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/* `next dev` reaches whatever backend and transport the developer's own environment names: the league's real people.
   The boot arms the scheduler under a production build's `NODE_ENV` alone. Each case states the value it boots under,
   `next dev`'s and the suite's own, rather than taking whichever the project running it sets. */
it.each(["development", "test"])("arms nothing under the NODE_ENV %s", async (nodeEnv) => {
  vi.stubEnv("NODE_ENV", nodeEnv);
  await register();
  vi.advanceTimersByTime(3 * HOUR_MS);
  await backend.answered();

  expect(backend.sent, "a pass reached the backend").toStrictEqual([]);
  // The boot ran to its end, so the silence is the scheduler's.
  expect(log.lines().map(({ message }) => message)).toStrictEqual(["system.started"]);
});
