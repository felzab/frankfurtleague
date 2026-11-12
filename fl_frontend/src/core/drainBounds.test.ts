import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";
import { z } from "zod";

import { FETCH_TIMEOUT_MS } from "./api.ts";
import { MAIL_TIMEOUT_MS } from "./mail.ts";

/**
 * The drain's two bounds as the backend's lease counts them; `fl_backend/tests/api/test_outbox_services.py` holds the
 * lease's half. Strict, so a bound the lease adds fails here until the drain holds it too.
 */
const DRAIN_BOUNDS = z
  .strictObject({ fetch_timeout_ms: z.number(), mail_timeout_ms: z.number() })
  .parse(
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "fl_backend", "tests", "shared", "drain_bounds.json"), "utf8")),
  );

/* A bound raised here alone lets a page of sends outlive the backend's lease, whose rows the next drain then sends again. */
it("bounds each backend call and each send as the backend's lease counts them", () => {
  expect({ fetch_timeout_ms: FETCH_TIMEOUT_MS, mail_timeout_ms: MAIL_TIMEOUT_MS }).toStrictEqual(DRAIN_BOUNDS);
});
