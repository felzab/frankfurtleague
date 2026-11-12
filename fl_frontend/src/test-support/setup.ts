import { vi } from "vitest";

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
