import { BootRefusal } from "./core/bootRefusal";

// The code `scripts/lib/_lib.sh :: check_frontend_boot_config` reads as a refusal, apart from a fault's 1:
// collapsed into one, a host's bad file would read as a check the deploy could not make, and go on.
const REFUSED = 3;

export async function registerOnNode() {
  const { frontend_config, checkedAs } = await passBootGates().catch((refusal: unknown) => {
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
  // and the league's real people. Compared to "on" rather than "off": a skipped validation leaves it
  // undefined, where a negated test would arm.
  if (process.env.NODE_ENV === "production" && frontend_config.BEWERBUNG_SWEEP === "on") {
    const { armBewerbungSweep } = await import("./features/bewerbungen/sweep");
    armBewerbungSweep();
  }

  // Its own switch and timer, never the application sweep's: an operator stops account deletion alone,
  // and a slow application pass skips none of it. Compared to "on" for the reason above.
  if (process.env.NODE_ENV === "production" && frontend_config.KONTO_SWEEP === "on") {
    const { armKontoSweep } = await import("./features/funktionen/sweep");
    armKontoSweep();
  }

  // Under the switch the activation's press deletes under, and never behind the application sweep's: the press tells
  // the administrator the next hourly pass deletes what it left. Compared to "on" for the reason above.
  if (process.env.NODE_ENV === "production" && frontend_config.LOESCHUNG_SWEEP === "on") {
    const { armLoeschungSweep } = await import("./features/saisons/sweep");
    armLoeschungSweep();
  }

  // Its own switch, never another sweep's: arming it starts the league's fixture mail, and an operator stops every
  // season's at once with it alone. Compared to "on" for the reason above.
  if (process.env.NODE_ENV === "production" && frontend_config.SPIEL_SWEEP === "on") {
    const { armSpielSweep } = await import("./features/spielbestaetigungen/sweep");
    armSpielSweep();
  }

  // Never behind the sweep's switch, which a local stack sets off: a change to who administers is
  // announced wherever a production build runs, and a stack that mails nothing counts it as told.
  if (process.env.NODE_ENV === "production") {
    const { armBerechtigungenAbgleich } = await import("./features/berechtigungen/abgleich");
    armBerechtigungenAbgleich();
  }

  // Unawaited: Next serves nothing until this hook returns, and the site serves without these
  // indexes, where an outage of the store would otherwise hold every page.
  if (process.env.NODE_ENV === "production") {
    const { buildAuthIndexes } = await import("./core/authIndexes");
    void buildAuthIndexes();
  }
}

/** The boot gates, each writing its own CRITICAL line before it throws: the environment and the secret files, the deployment a preflight names, then the signing key. */
async function passBootGates() {
  // Importing it *is* the gate — validation runs during this module load, before anything is served.
  // Taken apart where it loads: the whole namespace would carry every secret's reader.
  const { bootCheck, frontend_config, refuseInvalidEnvironment } = await import("./core/config");
  const checkedAs = bootCheck();

  // The schema demands production's files and keys on `APP_ENV`'s word alone, so a production host whose
  // file says `local` passes every gate holding none of them: the preflight names the deployment instead.
  if (checkedAs !== undefined && frontend_config.APP_ENV !== checkedAs) refuseInvalidEnvironment(["APP_ENV"]);

  // Before anything is served, as the environment gate is: without the key no guard can name an actor,
  // so a missing file would otherwise surface as every signed-in page failing.
  const { loadActorSigningKeyAtBoot } = await import("./core/actorToken");
  await loadActorSigningKeyAtBoot();

  return { frontend_config, checkedAs };
}
