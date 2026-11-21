import { BootRefusal } from "./core/bootRefusal";
import { logger } from "./core/logging";
import { readTraceparent, TRACEPARENT_HEADER } from "./core/trace";
import { armScheduler, loadJobs } from "./scheduler";

import type { Instrumentation } from "next";

// A refused configuration's exit, apart from a fault's 1: `docker compose ps` shows it on the restarting container,
// `Restarting (3)`, which tells a host's bad file from a crash before anyone opens the log. The backend's
// `BOOT_REFUSED` is the same 3, but uvicorn exits 3 for any start that fails, so there it says only that the boot
// never served.
const REFUSED = 3;

export async function registerOnNode() {
  // Importing it *is* the boot's gate, over the environment and the secret files, each refusal writing its own
  // CRITICAL line before it throws. Taken apart where it loads: the whole namespace would carry every secret's reader.
  const { frontend_config, heartbeatUrl } = await import("./core/config").catch((refusal: unknown) => {
    // Next logs a throwing hook and serves on, every page a 500; a dead container is what a restart
    // policy and the deploy's rollback read. The empty write's
    // callback runs once the CRITICAL line has left.
    process.exitCode = refusal instanceof BootRefusal ? REFUSED : 1;
    process.stdout.write("", () => process.exit());
    throw refusal;
  });

  // The one line per start that says which build runs: the log driver records no image version of its own.
  logger.info("system.started", { version: frontend_config.APP_VERSION ?? null });

  // A production build alone arms the passes: a test run boots under `test`, and a pass armed there would send its
  // requests into cases that name none. The hold arms nothing, and says so: the heartbeat then misses its pings.
  if (process.env.NODE_ENV === "production" && frontend_config.RESTORE_HOLD === "on") logger.warn("scheduler.held");
  else if (process.env.NODE_ENV === "production") armScheduler(await loadJobs(), heartbeatUrl());

  // Unawaited, both: Next serves nothing until this hook returns, and the public pages serve without the sign-in
  // store and its indexes, where an outage of the store would otherwise hold every page.
  if (process.env.NODE_ENV === "production") {
    const [{ connectSignInStore }, { buildAuthIndexes }] = await Promise.all([import("./core/db"), import("./core/authIndexes")]);
    void connectSignInStore();
    void buildAuthIndexes();
  }
}

/** An error and the fields this line reads where it carries them: a call error's trace and status, Next's digest. */
type Thrown = Error & { traceId?: unknown; statusCode?: unknown; digest?: unknown };

const stringOf = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

// Whatever the server threw arrives here, `undefined` included, so it is narrowed before any field is read: a throw of
// this hook's own reaches Next's plain-text report, and the line joining the crash to its request is lost.
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const failed: Thrown | undefined = err instanceof Error ? err : undefined;

  // Two different jobs: `trace_id` names the page request that failed, `fetch_trace_id` the
  // outbound call -- distinct whenever the fetch ran as a cache fill.
  const raw = request.headers[TRACEPARENT_HEADER];
  const requestId = readTraceparent(Array.isArray(raw) ? raw[0] : raw);
  const fetchId = stringOf(failed?.traceId);

  // The name and the join keys, never the stack: Next prints the error itself beside this hook.
  logger.error("system.request_crashed", undefined, {
    name: failed?.name ?? "unknown",
    trace_id: requestId,
    fetch_trace_id: fetchId !== requestId ? fetchId : undefined,
    // Set on the error, never on the context: the key joining this line to the error Next prints beside it.
    digest: stringOf(failed?.digest),
    route: context.routePath,
    // Which stage captured it: a render, a route handler, an action or the proxy; the Server Components render, its
    // payload or the HTML render; and a revalidation's reason, none on a plain request.
    route_type: context.routeType,
    render_source: context.renderSource,
    revalidate_reason: context.revalidateReason,
    // The failing call's own status, and none where it carries none: Next hands this hook no response
    // status, so a default here would be a figure nothing answered.
    status: typeof failed?.statusCode === "number" ? failed.statusCode : undefined,
  });
};
