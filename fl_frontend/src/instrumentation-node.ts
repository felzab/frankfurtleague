import { BootRefusal } from "./core/bootRefusal";
import { requestOf } from "./core/errors";
import { logger } from "./core/logging";
import { runInBackground } from "./core/requestScope";
import { HOUR_MS } from "./core/timeUnits";
import { mintTraceId } from "./core/trace";

// The code `scripts/lib/_lib.sh :: check_frontend_boot_config` reads as a refusal, apart from a fault's 1:
// collapsed into one, a host's bad file would read as a check the deploy could not make, and go on.
const REFUSED = 3;

export async function registerOnNode() {
  const { checkedAs, frontend_config, heartbeatUrl } = await passBootGates().catch((refusal: unknown) => {
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

  // The one line per start that says which build runs: the json-file driver records no image version of its own.
  logger.info("system.started", { version: frontend_config.APP_VERSION ?? null });

  // `next dev` never sets NODE_ENV to production, and a developer's machine holds a real transport
  // and the league's real people. A restore's hold arms nothing, and says so: the heartbeat then misses its pings.
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

/**
 * What one job did in a pass, by count and never by person: `offen` the owed deletions or erasures it left, and
 * `fehler` what ended a job part-way, after the work its counts record.
 */
type Durchlauf = { readonly zaehlung: Readonly<Record<string, number | string | null>>; readonly offen: number; readonly fehler?: unknown };

/**
 * One background job. It rejects, or resolves with a `fehler`, where it could not finish what it owes; each job is
 * idempotent, so a pass after a failed one repeats nothing that went. A job that counts nothing resolves to nothing.
 */
type Job = { readonly name: string; readonly run: () => Promise<Durchlauf | void> };

/**
 * Every job, run in this order each pass and then the Postausgang's drain, which sends what they owed. Imported here,
 * never at the top of the module: a boot that judges and ends loads none of them.
 */
async function loadJobs(): Promise<{
  jobs: readonly Job[];
  drain: () => Promise<void>;
  takeDrainCounts: () => Readonly<Record<string, number>> & { readonly aufgegeben: number };
}> {
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
    takeDrainCounts: mail.takeDrainCounts,
  };
}

/**
 * Every job is idempotent and selects on a date or a lapse, so the hour decides only how late in the day a deadline is
 * acted on; every write drains the Postausgang behind its answer besides (`fl_frontend/src/core/api.ts :: sendToBackend`).
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
function armScheduler(passes: Awaited<ReturnType<typeof loadJobs>>, heartbeat: string | undefined): void {
  let laeuft = false;
  const tick = async () => {
    // A pass slower than the hour would otherwise run beside itself over the same rows.
    if (laeuft) {
      logger.warn("scheduler.pass_skipped");
      return;
    }

    laeuft = true;
    try {
      // A background pass under a trace of its own: its writes drain nothing behind a response, the pass draining last.
      await ping(heartbeat, await runInBackground(mintTraceId(), () => runPass(passes)));
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

/**
 * Every job, each whatever the one before it did, then the drain; answers what the heartbeat names, empty for a pass
 * that did all it owed. Writes one `scheduler.pass` line where anything happened, every job's counts and every drain's
 * since the last pass in it, and nothing for an idle pass: the heartbeat is what says a pass ran.
 */
async function runPass({ jobs, drain, takeDrainCounts }: Awaited<ReturnType<typeof loadJobs>>): Promise<readonly string[]> {
  const ausfaelle: string[] = [];
  const zaehlungen: Record<string, Durchlauf["zaehlung"]> = {};

  const failed = (name: string, error: unknown) => {
    // The job's name and the error's, never a person: a failure on any job's path can carry an address.
    logger.error("scheduler.job_failed", undefined, {
      job: name,
      name: error instanceof Error ? error.name : undefined,
      ...requestOf(error),
    });
    ausfaelle.push(`${name} failed`);
  };

  for (const { name, run } of jobs) {
    try {
      const durchlauf = await run();
      if (durchlauf === undefined) continue;

      zaehlungen[name] = durchlauf.zaehlung;
      if (durchlauf.fehler !== undefined) failed(name, durchlauf.fehler);
      else if (durchlauf.offen > 0) ausfaelle.push(`${name} left ${String(durchlauf.offen)}`);
    } catch (error) {
      failed(name, error);
    }
  }
  try {
    await drain();
  } catch (error) {
    failed("postausgang", error);
  }
  // Every drain's, a write's among them, whether this pass's own one finished or not: a mail is given up by whichever
  // drain meets it.
  const postausgang = takeDrainCounts();
  zaehlungen["postausgang"] = postausgang;
  if (postausgang.aufgegeben > 0) ausfaelle.push(`postausgang gave up ${String(postausgang.aufgegeben)}`);

  const geschehen = Object.values(zaehlungen).some((zaehlung) => Object.values(zaehlung).some((wert) => typeof wert === "number" && wert > 0));
  if (ausfaelle.length > 0) logger.warn("scheduler.pass", { ...zaehlungen, ausfaelle: ausfaelle });
  else if (geschehen) logger.info("scheduler.pass", zaehlungen);

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

/** The boot gates, each writing its own CRITICAL line before it throws: the environment and the secret files, then the deployment a preflight names. */
async function passBootGates() {
  // Importing it *is* the gate — validation runs during this module load, before anything is served.
  // Taken apart where it loads: the whole namespace would carry every secret's reader.
  const { bootCheck, frontend_config, heartbeatUrl, refuseInvalidEnvironment } = await import("./core/config");
  const checkedAs = bootCheck();

  // The schema demands production's files and keys on `APP_ENV`'s word alone, so a production host whose
  // file says `local` passes every gate holding none of them: the preflight names the deployment instead.
  if (checkedAs !== undefined && frontend_config.APP_ENV !== checkedAs) refuseInvalidEnvironment(["APP_ENV"]);

  return { checkedAs, frontend_config, heartbeatUrl };
}
