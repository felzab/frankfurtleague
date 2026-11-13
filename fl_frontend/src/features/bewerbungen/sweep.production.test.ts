import { networkFailure, serveBackend } from "@/test-support/backend.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { expect, it } from "vitest";

/* Run under a production build's `NODE_ENV`, whose JSON line carries `trace_id`: the plain line every other project
   writes leaves it out, and the trace is what joins a half's failure line to the backend's own for that request. */

const SAISONS = ["2526", "2627"];

/** The calls that fail, each on the network. */
const FAILING = new Set(["POST /bewerbungen/sweep/2526", "POST /registrierungen/sweep/2627"]);

const backend = serveBackend(({ method, path }) => {
  const call = `${method} ${path}`;
  if (FAILING.has(call)) return networkFailure();
  if (call === "GET /bewerbungen/sweep") return { saison_ids: SAISONS };
  const saisonId = SAISONS.find((id) => call === `POST /bewerbungen/sweep/${id}` || call === `POST /registrierungen/sweep/${id}`);
  if (saisonId !== undefined && path.startsWith("/bewerbungen/")) {
    return {
      saison_id: saisonId,
      reminded: 0,
      erased: 0,
      erased_declined: 0,
      erased_accepted: 0,
      erased_without_decision: 0,
      kontakt_blocks_emptied: 0,
      failed: 0,
    };
  }
  if (saisonId !== undefined)
    return { saison_id: saisonId, reminded: 0, erased_unconfirmed: 0, erased_without_decision: 0, erased_declined: 0, failed: 0 };
  if (call === "POST /address_change/sweep") return { removed: 0, effective: 0, discarded: 0, remaining: 0, after: null };
  if (call === "GET /address_change/sweep/moves") return { moves: [] };
  if (call === "POST /schiedsrichter/sweep") return { erased: 0, failed: 0 };
  return undefined;
});
const log = captureLog();

const { runBewerbungSweep } = await import("./sweep.ts");

/** The trace a request was sent under, off the `traceparent` the backend read: `00-<trace>-<span>-<flags>`. */
const traceOf = (call: string): string | undefined =>
  backend.sent
    .find(({ method, path }) => `${method} ${path}` === call)
    ?.headers.get("traceparent")
    ?.split("-")[1];

it("runs under a production build's NODE_ENV", () => {
  expect(process.env.NODE_ENV, "a project writing the plain line shows no trace").toBe("production");
});

/* Each half apart: a throw in the application's clocks skips no registration, whose rows hold a minor's name,
   address and birthdate. */
it("runs every other half, files a line naming the half and the season, and then fails", async () => {
  expect((await runBewerbungSweep()).error).toBeInstanceOf(AggregateError);

  expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual([
    "GET /bewerbungen/sweep",
    "POST /bewerbungen/sweep/2526",
    "POST /registrierungen/sweep/2526",
    "POST /bewerbungen/sweep/2627",
    "POST /registrierungen/sweep/2627",
    "POST /address_change/sweep",
    "GET /address_change/sweep/moves",
    "POST /schiedsrichter/sweep",
  ]);
  const failures = log
    .lines()
    .filter(({ level }) => level === "ERROR")
    .map(({ message, raw }) => ({ message, line: JSON.parse(raw) as Record<string, unknown> }));
  expect(failures.map(({ message, line: { name, trace_id, saison_id } }) => ({ message, name, trace_id, saison_id }))).toStrictEqual([
    { message: "bewerbung.sweep_failed", name: "APINetworkError", trace_id: traceOf("POST /bewerbungen/sweep/2526"), saison_id: "2526" },
    {
      message: "registrierung.sweep_failed",
      name: "APINetworkError",
      trace_id: traceOf("POST /registrierungen/sweep/2627"),
      saison_id: "2627",
    },
  ]);
  // Each request mints a trace of its own outside a request's scope, so the two lines carry two traces, neither the
  // `SYSTEM` a line falls back to.
  expect(new Set(failures.map(({ line }) => line["trace_id"])).size).toBe(2);
});
