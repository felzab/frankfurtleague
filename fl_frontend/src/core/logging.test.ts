import { documentsWrittenByAsync } from "@/test-support/stdoutCapture.ts";
import { MongoServerError } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logging.ts";
import { runWithRequestScope } from "./requestScope.ts";

// Looked for whole, never as any "@": a stack frame's path carries one wherever the package store
// spells a version, as pnpm's `.pnpm/<name>@<version>/` does.
const ADDRESS = "vorstand@example.org";

const TRACE = "c".repeat(32);

beforeEach(() => void vi.stubEnv("NODE_ENV", "production"));
afterEach(() => void vi.unstubAllEnvs());

describe("logger", () => {
  it("writes no address a store error or a field quoted, and keeps the error's frames", async () => {
    const duplicate = new MongoServerError({
      message: `E11000 duplicate key error collection: auth.user index: user_email_uidx dup key: { email: "${ADDRESS}" }`,
      code: 11000,
      keyValue: { email: ADDRESS },
    });

    const [line] = await documentsWrittenByAsync(() => Promise.resolve(logger.error("auth.crash", duplicate, { recipient: ADDRESS })));

    expect(JSON.stringify(line)).not.toContain(ADDRESS);
    expect(line).toMatchObject({ error: { name: "MongoServerError", stack: expect.stringMatching(/^MongoServerError: E11000 .*\n {4}at /) } });
  });

  // The trace is what joins a line to the edge's and the backend's for the same request.
  it("writes the request's trace inside a scope, and SYSTEM outside one", async () => {
    const lines = await documentsWrittenByAsync(async () => {
      await runWithRequestScope({ traceId: TRACE }, () => Promise.resolve(logger.info("auth.signed_in")));
      logger.info("system.started");
    });

    expect(lines.map(({ trace_id }) => trace_id)).toStrictEqual([TRACE, "SYSTEM"]);
  });
});
