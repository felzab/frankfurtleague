import { serveBackend } from "@/test-support/backend.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/* Every job the scheduler would run is the real one, over a backend that answers nothing: a pass armed here would send
   its first request into a case that names none, which fails it, and be on the record of what the backend saw. */
const backend = serveBackend();
const log = captureLog();

const { register } = await import("./instrumentation.ts");

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => void vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] }));
afterEach(() => void vi.useRealTimers());

/* `next dev` reaches whatever backend and transport the developer's own environment names: the league's real people.
   Run by the `unit-development` project under `next dev`'s `NODE_ENV`. */
it("arms nothing under a development build", async () => {
  // A project that set none would boot under `test`, and the case would prove nothing of `next dev`.
  expect(process.env.NODE_ENV).toBe("development");
  await register();
  vi.advanceTimersByTime(3 * HOUR_MS);
  await backend.answered();

  expect(backend.sent, "a pass reached the backend").toStrictEqual([]);
  // The boot ran to its end, so the silence is the scheduler's.
  expect(log.lines().map(({ message }) => message)).toStrictEqual(["system.started"]);
});
