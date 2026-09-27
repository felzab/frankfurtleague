export async function registerOnNode() {
  const frontend_config = await passBootGates().catch((refusal: unknown) => {
    // Next logs a throwing hook and serves on, every page a 500; a dead container is what a restart
    // policy and the deploy's rollback read (`docs/frontend/spec.md :: I476`). The empty write's
    // callback runs once the CRITICAL line has left.
    process.exitCode = 1;
    process.stdout.write("", () => process.exit());
    throw refusal;
  });

  // The name alone, never its value: a list of administrators' addresses stays off the stream.
  if (frontend_config.ALLOWED_ADMIN_EMAILS !== undefined) {
    const { logger } = await import("./core/logging");
    logger.warn("config.retired_variable", { error_code: "FE-BOOT-002", variables: "ALLOWED_ADMIN_EMAILS" });
  }

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

/** The two boot gates, each writing its own CRITICAL line before it throws: the environment, then the signing key. */
async function passBootGates() {
  // Importing it *is* the gate — validation runs during this module load, before anything is served.
  const { frontend_config } = await import("./core/config");

  // Installed before the first request can error, so Next's own multi-line console dumps still
  // reach the log as one JSON document per line; the shim itself stands down under the console
  // format, at the line that would otherwise recurse.
  const { installConsoleShim } = await import("./core/consoleShim");
  installConsoleShim();

  // Before anything is served, as the environment gate is: without the key no guard can name an actor,
  // so a missing file would otherwise surface as every signed-in page failing.
  const { loadActorSigningKeyAtBoot } = await import("./core/actorToken");
  await loadActorSigningKeyAtBoot();

  return frontend_config;
}
