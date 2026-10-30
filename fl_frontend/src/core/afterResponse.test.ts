import { expect, it, vi } from "vitest";

/** The restore's hold the module reads, which the case sets. */
const settings = { RESTORE_HOLD: "off" };

/** Work handed to Next's `after`, collected rather than run: the case asks only whether a drain was scheduled. */
const scheduled: unknown[] = [];

vi.doMock("@/core/config.ts", () => ({ frontend_config: settings }));
vi.doMock("next/server", async () => ({
  ...(await vi.importActual<object>("next/server")),
  after: (task: unknown) => void scheduled.push(task),
}));
vi.doMock("@/core/mail.ts", () => ({ drainPostausgang: () => expect.unreachable("the drain ran inside the call") }));

const { drainSoon } = await import("./afterResponse.ts");

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
