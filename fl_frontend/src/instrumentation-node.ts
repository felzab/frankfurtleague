import { BootRefusal } from "./core/bootRefusal";
import { requestOf } from "./core/errors";
import { logger } from "./core/logging";
import { HOUR_MS } from "./core/timeUnits";

// The code `scripts/lib/_lib.sh :: check_frontend_boot_config` reads as a refusal, apart from a fault's 1:
// collapsed into one, a host's bad file would read as a check the deploy could not make, and go on.
const REFUSED = 3;

export async function registerOnNode() {
  const { checkedAs, heartbeatUrl } = await passBootGates().catch((refusal: unknown) => {
    // Next logs a throwing hook and serves on, every page a 500; a dead container is what a restart
    // policy and the deploy's rollback read. The empty write's
    // callback runs once the CRITICAL line has left.
    process.exitCode = refusal instanceof BootRefusal ? REFUSED : 1;
    process.stdout.write("", () => process.exit());
    throw refusal;
  });

  // Before anything below is armed: a one-off container would otherwise sweep and announce beside the
  // service it is judging for.
  if (checkedAs !== undefined) process.exit(0);

  // `next dev` never sets NODE_ENV to production, and a developer's machine holds a real transport
  // and the league's real people.
  if (process.env.NODE_ENV === "production") armScheduler(await loadJobs(), heartbeatUrl());

  // Unawaited: Next serves nothing until this hook returns, and the site serves without these
  // indexes, where an outage of the store would otherwise hold every page.
  if (process.env.NODE_ENV === "production") {
    const { buildAuthIndexes } = await import("./core/authIndexes");
    void buildAuthIndexes();
  }
}

/**
 * One background job. It rejects where it could not finish what it owes, and resolves to the number of owed deletions
 * or erasures it left, none where it returns nothing; each job is idempotent, so a pass after a failed one repeats
 * nothing that went.
 */
type Job = { readonly name: string; readonly run: () => Promise<number | void> };

/**
 * Every job, run in this order each pass and then the Postausgang's drain, which sends what they owed. Imported here,
 * never at the top of the module: a boot that judges and ends loads none of them.
 */
async function loadJobs(): Promise<{ jobs: readonly Job[]; drain: () => Promise<{ aufgegeben: number }> }> {
  const [bewerbungen, konto, loeschung, spiele, berechtigungen, mail] = await Promise.all([
    import("./features/bewerbungen/sweep"),
    import("./features/funktionen/sweep"),
    import("./features/saisons/sweep"),
    import("./features/spielbestaetigungen/sweep"),
    import("./features/berechtigungen/abgleich"),
    import("./core/mail"),
  ]);

  return {
    jobs: [
      { name: "bewerbungen", run: bewerbungen.runBewerbungSweep },
      { name: "konto", run: konto.runKontoSweep },
      { name: "loeschung", run: loeschung.runLoeschungSweep },
      { name: "spielbestaetigungen", run: spiele.runSpielSweep },
      { name: "berechtigungen", run: berechtigungen.runBerechtigungenAbgleich },
    ],
    drain: mail.drainPostausgang,
  };
}

/**
 * Every job is idempotent and selects on a date or a lapse, so the hour decides only how late in the day a deadline is
 * acted on; a write that owes a mail drains at once besides (`fl_frontend/src/core/afterResponse.ts :: drainSoon`).
 */
const PASS_INTERVAL_MS = HOUR_MS;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend answers. The interval
 * alone would skip a container recreated daily.
 */
const FIRST_PASS_DELAY_MS = 60 * 1000;

/**
 * The one scheduler, for the life of this process: production runs one frontend container, so one process holds the
 * timer and no cross-process lease is built. Armed and returned at once, the first pass never awaited: Next serves
 * nothing until `register` returns (installed `03-file-conventions/instrumentation.md`).
 */
function armScheduler({ jobs, drain }: Awaited<ReturnType<typeof loadJobs>>, heartbeat: string | undefined): void {
  let laeuft = false;
  const tick = async () => {
    // A pass slower than the hour would otherwise run beside itself over the same rows.
    if (laeuft) {
      logger.warn("scheduler.pass_skipped");
      return;
    }

    laeuft = true;
    try {
      await ping(heartbeat, await runPass(jobs, drain));
    } finally {
      laeuft = false;
    }
  };

  const erster = setTimeout(() => void tick(), FIRST_PASS_DELAY_MS);
  const handle = setInterval(() => void tick(), PASS_INTERVAL_MS);
  // Unreferenced, so neither holds a shutdown open: the listening socket keeps this process alive.
  erster.unref();
  handle.unref();
}

/** Every job, each whatever the one before it did, then the drain; answers what the heartbeat names, empty for a pass that did all it owed. */
async function runPass(jobs: readonly Job[], drain: () => Promise<{ aufgegeben: number }>): Promise<readonly string[]> {
  const ausfaelle: string[] = [];

  const run = async (name: string, job: () => Promise<string | undefined>) => {
    try {
      const ausfall = await job();
      if (ausfall !== undefined) ausfaelle.push(`${name} ${ausfall}`);
    } catch (error) {
      // The job's name and the error's, never a person: a failure on any job's path can carry an address.
      logger.error("scheduler.job_failed", undefined, {
        job: name,
        name: error instanceof Error ? error.name : undefined,
        ...requestOf(error),
      });
      ausfaelle.push(`${name} failed`);
    }
  };

  for (const { name, run: job } of jobs) {
    await run(name, async () => {
      const offen = await job();
      return typeof offen === "number" && offen > 0 ? `left ${String(offen)}` : undefined;
    });
  }
  await run("postausgang", async () => {
    const { aufgegeben } = await drain();
    return aufgegeben > 0 ? `gave up ${String(aufgegeben)}` : undefined;
  });

  return ausfaelle;
}

/** Long enough for the monitor's answer, short enough that a hung one never reaches the next pass. */
const HEARTBEAT_TIMEOUT_MS = 10 * 1000;

/**
 * The pass reported to Better Stack's heartbeat, `/fail` with the jobs it names where it left anything owed
 * (https://betterstack.com/docs/uptime/cron-and-heartbeat-monitor/). A pass that never pings is what the monitor
 * alerts on, so the ping never fails the pass: its own failure is a line.
 */
async function ping(url: string | undefined, ausfaelle: readonly string[]): Promise<void> {
  if (url === undefined) return;

  try {
    const signal = AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS);
    const res =
      ausfaelle.length === 0
        ? await fetch(url, { signal })
        : await fetch(`${url}/fail`, { method: "POST", body: ausfaelle.join("\n"), signal });
    if (!res.ok) logger.warn("scheduler.heartbeat_refused", { status: res.status });
  } catch (error) {
    // The error's name alone: its message can quote the address, whose token is the credential.
    logger.warn("scheduler.heartbeat_failed", { name: error instanceof Error ? error.name : undefined });
  }
}

/** The boot gates, each writing its own CRITICAL line before it throws: the environment and the secret files, the deployment a preflight names, then the signing key. */
async function passBootGates() {
  // Importing it *is* the gate — validation runs during this module load, before anything is served.
  // Taken apart where it loads: the whole namespace would carry every secret's reader.
  const { bootCheck, frontend_config, heartbeatUrl, refuseInvalidEnvironment } = await import("./core/config");
  const checkedAs = bootCheck();

  // The schema demands production's files and keys on `APP_ENV`'s word alone, so a production host whose
  // file says `local` passes every gate holding none of them: the preflight names the deployment instead.
  if (checkedAs !== undefined && frontend_config.APP_ENV !== checkedAs) refuseInvalidEnvironment(["APP_ENV"]);

  return { checkedAs, heartbeatUrl };
}
