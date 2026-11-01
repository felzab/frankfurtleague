import { beforeEach, expect, it, vi } from "vitest";

/** The restore's hold the module reads, which the case sets. */
const settings = { RESTORE_HOLD: "off" };

/** Work handed to Next's `after`, collected rather than run, so a case runs it where it reads the outcome. */
const scheduled: (() => Promise<void>)[] = [];

/** `performance.now()`'s reading, which a drain moves past the request's own 30-second cut. */
let clock = 0;

/** Whether each drain's next call would be born aborted once that much time had passed. */
const cut: boolean[] = [];

vi.doMock("@/core/config.ts", () => ({ frontend_config: settings }));
vi.doMock("next/server", async () => ({
  ...(await vi.importActual<object>("next/server")),
  after: (task: () => Promise<void>) => void scheduled.push(task),
}));
vi.doMock("@/core/mail.ts", () => ({
  drainOutbox: async () => {
    clock += 31000;
    cut.push(boundCall(15000).aborted);
  },
}));

const { drainSoon } = await import("./afterResponse.ts");
const { boundCall } = await import("./requestScope.ts");

beforeEach(() => {
  scheduled.length = 0;
  cut.length = 0;
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

/* Under a restore's hold a write's mail would otherwise leave before the restore's steps are done: to somebody not yet
   erased again, or a second time for a mail the lost window sent. */
it("schedules no drain under a restore's hold, and one without it", () => {
  settings.RESTORE_HOLD = "on";
  drainSoon();
  expect(scheduled.length, "a held drain was scheduled").toBe(0);

  settings.RESTORE_HOLD = "off";
  drainSoon();
  expect(scheduled.length, "the case proves nothing: an unheld drain was not scheduled either").toBe(1);
});

/* A page of ten sends and reports runs far past a request's 30 seconds at the provider's worst; under that cut every
   send after it would be refused unsent and the page left to the hourly pass. */
it("drains behind the response under no request's cut, so a drain past 30 seconds still sends", async () => {
  drainSoon();
  const [drain] = scheduled;
  expect(drain, "no drain was scheduled").toBeDefined();

  await drain?.();

  expect(cut, "the drain's call after 31 seconds was cut").toStrictEqual([false]);
});
