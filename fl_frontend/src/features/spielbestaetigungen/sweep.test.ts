import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/** Every line as it was written, its fields whole. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

const LISTE = "/spielbestaetigungen/sweep";

/** The listing's answer, and each season's pass's, which a case sets; an `Error` is thrown, as a failed call throws. */
let listeAnswer: () => unknown;
let passAnswer: (saisonId: string) => unknown;

const pass = (
  saisonId: string,
  counts: Partial<Record<"geschlossen" | "angefragt" | "erinnert" | "mails" | "fehlgeschlagen", number>> = {},
) => ({
  saison_id: saisonId,
  geschlossen: 0,
  angefragt: 0,
  erinnert: 0,
  mails: 0,
  fehlgeschlagen: 0,
  ...counts,
});

const calls = doubleApiClient(async (call: ApiCall, schema) => {
  const answer = call.endpoint === LISTE ? listeAnswer() : passAnswer(/^\/spielbestaetigungen\/sweep\/(\d+)$/.exec(call.endpoint)?.[1] ?? "");
  if (answer instanceof Error) throw answer;
  assert.ok(call.endpoint.startsWith(LISTE), `the pass reached a route nothing here answers: ${call.endpoint}`);
  // Parsed by the schema the real client parses with, so an answer this file composes cannot drift.
  return schema.parse(answer);
});

vi.doMock("@/core/logging.ts", () => ({
  logger: {
    debug: () => undefined,
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: (event: string, fields?: unknown) => void lines.push({ level: "warn", event, fields }),
    error: (event: string, _message: unknown, fields?: unknown) => void lines.push({ level: "error", event, fields }),
  },
}));

const { runSpielSweep } = await import("./sweep.ts");

beforeEach(() => {
  lines.length = 0;
  calls.length = 0;
  listeAnswer = () => ({ saison_ids: ["2627", "2728"] });
  passAnswer = (saisonId) => pass(saisonId);
});

describe("the fixture confirmation job", () => {
  it("sweeps every listed season and writes one line counting what the passes did", async () => {
    passAnswer = (saisonId) => pass(saisonId, saisonId === "2627" ? { geschlossen: 2, angefragt: 3, mails: 7 } : { erinnert: 1, mails: 2 });

    await runSpielSweep();

    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([LISTE, `${LISTE}/2627`, `${LISTE}/2728`]);
    expect(lines).toStrictEqual([
      {
        level: "info",
        event: "spielbestaetigung.sweep_pass",
        fields: { geschlossen: 2, angefragt: 3, erinnert: 1, mails: 9, fehlgeschlagen: 0 },
      },
    ]);
  });

  /* The scheduler reports a pass ending on a failure to the heartbeat, which a job answering with a line alone keeps from it. */
  it("rejects where a season's pass fails, sweeping no season after it", async () => {
    passAnswer = (saisonId) => (saisonId === "2627" ? new Error("the backend went away") : pass(saisonId));

    await expect(runSpielSweep()).rejects.toThrow("the backend went away");
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([LISTE, `${LISTE}/2627`]);
  });

  it("warns where a pass passed rows over, each pass moving on past them", async () => {
    passAnswer = (saisonId) => pass(saisonId, { fehlgeschlagen: 1 });

    await runSpielSweep();

    expect(lines.map(({ level, event }) => [level, event])).toStrictEqual([["warn", "spielbestaetigung.sweep_pass"]]);
  });
});
