import { requestOf } from "./core/errors";
import { logger } from "./core/logging";
import { runInBackground } from "./core/requestScope";
import { HOUR_MS, MINUTE_MS, SECOND_MS } from "./core/timeUnits";
import { mintTraceId } from "./core/trace";

/**
 * What one job did in a pass, by count and never by person: `open` the owed deletions or erasures it left, and
 * `error` what ended a job part-way, after the work its counts record.
 */
type JobRun = { readonly count: Readonly<Record<string, number | string | null>>; readonly open: number; readonly error?: unknown };

/**
 * One background job. It rejects, or resolves with an `error`, where it could not finish what it owes; each job is
 * idempotent, so a pass after a failed one repeats nothing that went. A job that counts nothing resolves to nothing.
 */
type Job = { readonly name: string; readonly run: () => Promise<JobRun | void> };

/**
 * Every job, run in this order each pass and then the Postausgang's drain, which sends what they owed. Imported here,
 * never at the top of the module: a boot that judges and ends loads none of them.
 */
export async function loadJobs(): Promise<{
  jobs: readonly Job[];
  drain: () => Promise<void>;
  takeDrainCounts: () => Readonly<Record<string, number>> & { readonly abandoned: number };
}> {
  const [saisons, addressChange, schiedsrichter, account, erasure, spiele, grants, mail] = await Promise.all([
    import("./features/saisons/sweep"),
    import("./features/address-change/sweep"),
    import("./features/schiedsrichter/sweep"),
    import("./features/account/sweep"),
    import("./features/spieler/sweep"),
    import("./features/spielbestaetigungen/sweep"),
    import("./features/grants/sweep"),
    import("./core/mail"),
  ]);

  return {
    jobs: [
      { name: "saisons", run: saisons.runSaisonSweep },
      { name: "address-change", run: addressChange.runAddressChangeSweep },
      { name: "schiedsrichter", run: schiedsrichter.runSchiedsrichterSweep },
      { name: "account", run: account.runAccountSweep },
      { name: "erasure", run: erasure.runErasureSweep },
      { name: "spielbestaetigungen", run: spiele.runSpielSweep },
      { name: "grants", run: grants.runHandoverPass },
    ],
    drain: mail.drainOutbox,
    takeDrainCounts: mail.takeDrainCounts,
  };
}

/**
 * Every job is idempotent and selects on a date or a lapse, so the hour decides only how late in the day a deadline is
 * acted on; every write drains the Postausgang behind its answer besides.
 */
const PASS_INTERVAL_MS = HOUR_MS;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend answers. The interval
 * alone would skip a container recreated daily.
 */
const FIRST_PASS_DELAY_MS = MINUTE_MS;

/**
 * The one scheduler, for the life of this process: production runs one frontend container, so one process holds the
 * timer and no cross-process lease is built. Armed and returned at once, the first pass never awaited: Next serves
 * nothing until `register` returns.
 */
export function armScheduler(passes: Awaited<ReturnType<typeof loadJobs>>, heartbeat: string | undefined): void {
  let running = false;
  const tick = async () => {
    // A pass slower than the hour would otherwise run beside itself over the same rows.
    if (running) {
      logger.warn("scheduler.pass_skipped");
      return;
    }

    running = true;
    try {
      // A background pass under a trace of its own: its writes drain nothing behind a response, the pass draining last.
      await ping(heartbeat, await runInBackground(mintTraceId(), () => runPass(passes)));
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => void tick(), FIRST_PASS_DELAY_MS);
  const handle = setInterval(() => void tick(), PASS_INTERVAL_MS);
  // Unreferenced, so neither holds a shutdown open: the listening socket keeps this process alive.
  first.unref();
  handle.unref();
}

/**
 * Every job, each whatever the one before it did, then the drain; answers what the heartbeat names, empty for a pass
 * that did all it owed. Writes one `scheduler.pass` line where anything happened, every job's counts and every drain's
 * since the last pass in it, and nothing for an idle pass: the heartbeat is what says a pass ran.
 */
async function runPass({ jobs, drain, takeDrainCounts }: Awaited<ReturnType<typeof loadJobs>>): Promise<readonly string[]> {
  const failures: string[] = [];
  const counts: Record<string, JobRun["count"]> = {};

  const failed = (name: string, error: unknown) => {
    // The job's name and the error's, never a person: a failure on any job's path can carry an address.
    logger.error("scheduler.job_failed", undefined, {
      job: name,
      name: error instanceof Error ? error.name : undefined,
      ...requestOf(error),
    });
    failures.push(`${name} failed`);
  };

  for (const { name, run } of jobs) {
    try {
      const jobRun = await run();
      if (jobRun === undefined) continue;

      counts[name] = jobRun.count;
      if (jobRun.error !== undefined) failed(name, jobRun.error);
      else if (jobRun.open > 0) failures.push(`${name} left ${String(jobRun.open)}`);
    } catch (error) {
      failed(name, error);
    }
  }
  try {
    await drain();
  } catch (error) {
    failed("outbox", error);
  }
  // Every drain's, a write's among them, whether this pass's own one finished or not: a mail is given up by whichever
  // drain meets it.
  const outbox = takeDrainCounts();
  counts["outbox"] = outbox;
  if (outbox.abandoned > 0) failures.push(`outbox gave up ${String(outbox.abandoned)}`);

  const happened = Object.values(counts).some((count) => Object.values(count).some((value) => typeof value === "number" && value > 0));
  if (failures.length > 0) logger.warn("scheduler.pass", { ...counts, failures });
  else if (happened) logger.info("scheduler.pass", counts);

  return failures;
}

/** Long enough for the monitor's answer, short enough that a hung one never reaches the next pass. */
const HEARTBEAT_TIMEOUT_MS = 10 * SECOND_MS;

/**
 * The pass reported to Better Stack's heartbeat, `/fail` with the jobs it names where it left anything owed
 * (https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/). A pass that never pings is what the monitor
 * alerts on, so the ping never fails the pass: its own failure is a line.
 */
async function ping(url: string | undefined, failures: readonly string[]): Promise<void> {
  if (url === undefined) return;

  try {
    const signal = AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS);
    const res =
      failures.length === 0 ? await fetch(url, { signal }) : await fetch(`${url}/fail`, { method: "POST", body: failures.join("\n"), signal });
    if (!res.ok) logger.warn("scheduler.heartbeat_refused", { status: res.status });
  } catch (error) {
    // The error's name alone: its message can quote the address, whose token is the credential.
    logger.warn("scheduler.heartbeat_failed", { name: error instanceof Error ? error.name : undefined });
  }
}
