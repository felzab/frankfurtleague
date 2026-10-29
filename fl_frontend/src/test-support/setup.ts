import { vi } from "vitest";

// `server-only` throws unless the bundler resolves it under React's `react-server` condition, which
// Next's server build sets and a test never does. Empty here, as the server build gets it.
vi.mock("server-only", () => ({}));
