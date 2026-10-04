import { BootRefusal } from "./core/bootRefusal";

// The code `scripts/lib/_lib.sh :: check_frontend_boot_config` reads as a refusal, apart from a fault's 1:
// collapsed into one, a host's bad file would read as a check the deploy could not make, and go on.
const REFUSED = 3;

export async function registerOnNode() {
  // Set by the deploy's and the local stack's preflight alone, to the deployment it is about to start:
  // the boot judges what it was handed and ends instead of serving. Read here and nowhere else.
  const checkedAs = process.env.BOOT_CHECK;

  const { frontend_config } = await passBootGates(checkedAs).catch((refusal: unknown) => {
    // Next logs a throwing hook and serves on, every page a 500; a dead container is what a restart
    // policy and the deploy's rollback read (`docs/frontend/spec.md :: I476`). The empty write's
    // callback runs once the CRITICAL line has left.
    process.exitCode = refusal instanceof BootRefusal ? REFUSED : 1;
    process.stdout.write("", () => process.exit());
    throw refusal;
  });

  // Before anything below is armed: a one-off container would otherwise sweep and announce beside the
  // service it is judging for.
  if (checkedAs !== undefined) process.exit(0);

  // `next dev` never sets NODE_ENV to production, and a developer's machine holds a real transport
  // and the league's real people. Compared to "on" rather than "off": a skipped validation leaves it
  // undefined, where a negated test would arm.
  if (process.env.NODE_ENV === "production" && frontend_config.BEWERBUNG_SWEEP === "on") {
    const { armBewerbungSweep } = await import("./features/bewerbungen/sweep");
    armBewerbungSweep();
  }

  // Never behind the sweep's switch, which a local stack sets off: a change to who administers is
  // announced wherever a production build runs, and a stack that mails nothing counts it as told.
  if (process.env.NODE_ENV === "production") {
    const { armBerechtigungenAbgleich } = await import("./features/berechtigungen/abgleich");
    armBerechtigungenAbgleich();
  }

  // Unawaited: Next serves nothing until this hook returns, and the site serves without these
  // indexes, where an outage of the store would otherwise hold every page (`docs/frontend/spec.md :: I498`).
  if (process.env.NODE_ENV === "production") {
    const { buildAuthIndexes } = await import("./core/authIndexes");
    void buildAuthIndexes();
  }
}

/** The boot gates, each writing its own CRITICAL line before it throws: the environment and the secret files, the deployment a preflight names, then the signing key. */
async function passBootGates(checkedAs: string | undefined) {
  // Importing it *is* the gate — validation runs during this module load, before anything is served.
  // Taken apart where it loads, as lint holds every load of it to: the whole namespace would carry
  // every secret's reader.
  const { frontend_config, refuseInvalidEnvironment } = await import("./core/config");

  // The schema demands production's files and keys on `APP_ENV`'s word alone, so a production host whose
  // file says `local` passes every gate holding none of them: the preflight names the deployment instead.
  if (checkedAs !== undefined && frontend_config.APP_ENV !== checkedAs) refuseInvalidEnvironment(["APP_ENV"]);

  // Installed before the first request can error, so Next's own multi-line console dumps still
  // reach the log as one JSON document per line; the shim itself stands down under the console
  // format, at the line that would otherwise recurse.
  const { installConsoleShim } = await import("./core/consoleShim");
  installConsoleShim();

  // Before anything is served, as the environment gate is: without the key no guard can name an actor,
  // so a missing file would otherwise surface as every signed-in page failing.
  const { loadActorSigningKeyAtBoot } = await import("./core/actorToken");
  await loadActorSigningKeyAtBoot();

  return { frontend_config };
}
