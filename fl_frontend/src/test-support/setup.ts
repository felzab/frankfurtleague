import { serveTheNetwork } from "@/test-support/backend.ts";
import { vi } from "vitest";

// Before any test file's own code, so no request of a file is sent past this machine: a request no case answers fails
// the case it was sent in (`fl_frontend/src/test-support/backend.ts`).
serveTheNetwork();

// `server-only` throws unless the bundler resolves it under React's `react-server` condition, which
// Next's server build sets and a test never does. Empty here, as the server build gets it.
vi.mock("server-only", () => ({}));

// `connection()` throws outside the request Next's server opens around a render or an action, which no
// test runs inside. Resolved here, as it resolves inside every request. `after()` throws there too, and
// schedules nothing here: a suite running the work behind an answer doubles it itself.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  connection: () => Promise.resolve(),
  after: () => undefined,
}));
