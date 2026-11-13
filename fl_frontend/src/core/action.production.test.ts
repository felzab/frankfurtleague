import { serveBackend } from "@/test-support/backend.ts";
import { cacheCalls } from "@/test-support/nextRequest.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { seat } from "@/test-support/subjectFixtures.ts";
import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { COPY } from "./copy";

// Under the production build's `NODE_ENV` (`fl_frontend/vitest.config.mts :: PRODUCTION_BUILD`): only its format writes
// every value a line is handed, an `error` that is no `Error` among them, which an action's lines are held to.

/** The endpoint each case's body sends to. */
const PROBE = "/probe";

// The body's own endpoint and nothing else: a request the action sends anywhere else fails its case.
const backend = serveBackend(({ method, path }) => (method === "POST" && path === PROBE ? {} : undefined));
const { arriveAs } = signedInRequest();
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { action } = await import("./action");
const { sendToBackend } = await import("./api");

/** A line as the production format wrote it, every key it carries, `error` among them. */
const documentOf = (raw: string): Record<string, unknown> => JSON.parse(raw) as Record<string, unknown>;

/** Whether a line carries an address anywhere, as typed or as the placeholder the logger scrubs one to. */
const carriesAnAddress = (raw: string): boolean => raw.includes("@") || raw.includes("[address]");

describe("the admin lane", () => {
  const ADDRESS = "lena@example.com";
  /** An admin create whose body sends the create and then throws, its message naming an address. */
  const create = action({
    lane: "admin",
    name: "create",
    input: z.object({ name: z.string().min(1) }),
    run: async () => {
      await sendToBackend(PROBE, { method: "POST", authType: "base" });
      throw new Error(`${ADDRESS} was refused`);
    },
  });

  it("answers any other throw as the unexpected failure, logging its name alone, and clears the tag", async () => {
    const answer = await create({ name: "Nord" });

    expect(answer).toStrictEqual({ ok: false, reason: COPY.shared.failure.unexpected });
    const lines = log.lines();
    expect(lines.map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([
      ["ERROR", "action.failed", { action: "create", name: "Error" }],
    ]);
    for (const { raw } of lines) {
      expect(documentOf(raw).error, "the thrown error reached the line").toBe(undefined);
      assert.ok(!carriesAnAddress(raw), `the error's message reached the line: ${raw}`);
    }
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual([`POST ${PROBE}`]);
    expect(cacheCalls.filter(({ name }) => name === "updateTag").map(({ args }) => args[0])).toStrictEqual(["site"]);
  });
});

describe("the person lane", () => {
  const PERSON = "spielerin@example.org";
  const register = action({
    lane: "person",
    claim: "seat",
    name: "melden",
    input: z.object({ team_id: z.string().min(1), saison_id: z.string().min(1) }),
    run: async () => {
      ran.push("body");
      return { ok: true, value: undefined };
    },
  });
  /** Whether the body ran. */
  const ran: string[] = [];

  it.each([
    ["in another season", { team_id: "t1", saison_id: "2026" }],
    ["at another team in the same season", { team_id: "t2", saison_id: "2027" }],
  ])("refuses a seat the person holds %s, naming nothing of the address", async (_where, held) => {
    await arriveAs({ email: PERSON, records: { seats: [seat(held)] } });
    ran.length = 0;
    // The arrival's own sign-in line is not the refusal's.
    log.clear();

    expect(await register({ team_id: "t1", saison_id: "2027" })).toStrictEqual({ ok: false, reason: COPY.shared.failure.stale });
    expect(ran).toStrictEqual([]);
    const lines = log.lines();
    expect(lines.map(({ level, message, fields }) => [level, message, fields])).toStrictEqual([
      ["INFO", "roles.refused", { operation: "melden", reason: "no_seat" }],
    ]);
    for (const { raw } of lines) {
      expect(documentOf(raw).error, "an error reached the line").toBe(undefined);
      assert.ok(!carriesAnAddress(raw), `the address reached the line: ${raw}`);
    }
  });
});
