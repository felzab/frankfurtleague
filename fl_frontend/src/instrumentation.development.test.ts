import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** Every job the scheduler started, by its name, and the drain. */
const ran: string[] = [];

const job = (name: string) => () => {
  ran.push(name);
  return Promise.resolve();
};

vi.doMock("@/core/config.ts", () => ({
  frontend_config: { APP_VERSION: "sha-1234567", RESTORE_HOLD: "off" },
  heartbeatUrl: () => undefined,
}));
vi.doMock("@/core/logging.ts", () => ({ logger: { info: () => undefined, warn: () => undefined, error: () => undefined } }));
vi.doMock("@/features/bewerbungen/sweep.ts", () => ({ runBewerbungSweep: job("bewerbungen") }));
vi.doMock("@/features/roles/sweep.ts", () => ({ runAccountSweep: job("account") }));
vi.doMock("@/features/saisons/sweep.ts", () => ({ runErasureSweep: job("erasure") }));
vi.doMock("@/features/spielbestaetigungen/sweep.ts", () => ({ runSpielSweep: job("spielbestaetigungen") }));
vi.doMock("@/features/grants/sweep.ts", () => ({ runHandoverPass: job("grants") }));
vi.doMock("@/core/mail.ts", () => ({
  drainOutbox: async () => {
    ran.push("outbox");
  },
  takeDrainCounts: () => ({ sent: 0, repeated: 0, abandoned: 0, held: 0, ignored: 0 }),
}));

const { register } = await import("./instrumentation.ts");

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => void vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] }));
afterEach(() => void vi.useRealTimers());

/* `next dev` reaches whatever backend and transport the developer's own environment names: the league's real people.
   Run by the `unit` project under the `test` Vitest sets, which the boot reads as it reads `next dev`'s `development`:
   as no production build. */
it("arms nothing under a development build", async () => {
  await register();
  vi.advanceTimersByTime(3 * HOUR_MS);
  await new Promise((resolve) => setImmediate(resolve));

  expect(ran).toStrictEqual([]);
});
