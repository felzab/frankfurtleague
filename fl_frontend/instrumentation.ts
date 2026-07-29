export { onRequestError as onRequestError } from "./src/core/instrumentation";

/**
 * Startup environment gate (R3b §S10.3).
 *
 * `SKIP_ENV_VALIDATION=true` is set in the Docker builder stage only, so the runner does validate --
 * but only on the first import of `config.ts`, which is the first request that needs it. The
 * container's healthcheck hits `/favicon.ico` and never touches config, so a truncated API key or a
 * typo'd admin email produced a green build, a green image and a healthy-looking container.
 *
 * Next calls `register()` once when the server starts, so importing the config here moves that
 * failure to boot. There is no second list of variable names to drift out of sync with `config.ts`.
 */
export async function register() {
  // Runs in every runtime; the config module is Node-only.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Letting this throw *is* the gate. Next rethrows from register() inside prepareImpl(), so the
  // server never finishes starting and the container exits non-zero. Do not catch it and call
  // process.exit instead: this module is also compiled for the Edge runtime, which has no
  // process.exit, and the reference alone fails that bundle.
  // config.ts's onValidationError has already reduced the message to variable names, never values.
  await import("./src/core/config");
}
